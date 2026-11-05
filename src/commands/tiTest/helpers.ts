import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import { apiRequest, type Tm1Config } from '../../tm1Client';
import { getConnectedIdsRestored } from '../../serverState/state';
import { findCallSites, splitArgs, offsetToLineCol } from '../../tiTestFramework/rewriter/tiSourceLexer';
import type { CommandDeps, ProcessFetchResult } from './types';
import { encodeODataKey } from '../../utils/odataKey';
import { isOk, Tm1HttpError } from '../../tm1Rest/httpError';
import { parseBody } from '../../tm1Rest/parseRest';

export const CELL_WRITE_FUNC_NAMES: ReadonlySet<string> = new Set([
  'cellputn',
  'cellputs',
  'cellincrementn',
]);

/** Static-analysis: every literal cube name passed as the 2nd arg to a Cell-write call. */
/** Visit every call site in `body`, recursing into each call's arguments so a
 *  call nested inside another call (e.g. DIMIX inside `IF(DIMIX(...)=0)`) is
 *  found too. Static detection that only looked at top-level statements missed
 *  dim/cube reads wrapped in IF/WHILE guards — the common case. */
function eachCallDeep(
  body: string,
  cb: (site: { name: string; argString: string }) => void,
): void {
  for (const site of findCallSites(body)) {
    cb(site);
    eachCallDeep(site.argString, cb);
  }
}

export function detectLiteralCubes(src: ProcessFetchResult): string[] {
  const cubes = new Set<string>();
  for (const body of [src.prolog, src.metadata, src.data, src.epilog]) {
    eachCallDeep(body, (site) => {
      if (!CELL_WRITE_FUNC_NAMES.has(site.name.toLowerCase())) return;
      const args = splitArgs(site.argString);
      if (args.length < 2) return;
      const a = args[1].trim();
      if (a.startsWith("'") && a.endsWith("'")) {
        cubes.add(a.slice(1, -1).replace(/''/g, "'"));
      }
    });
  }
  return [...cubes].sort();
}

/** Dim-read builtins whose FIRST arg is a literal dimension name. Used to fetch
 *  dimensions referenced DIRECTLY (DIMIX/ElementIndex/ELPAR/ATTRS/…) rather than
 *  via a cube — those never surface through detectLiteralCubes, so without this
 *  the simulator has no element/attribute data and returns 0/'' for them. */
export const DIM_READ_FUNC_NAMES: ReadonlySet<string> = new Set([
  'dimix', 'dimnm', 'dimsiz', 'dnlev',
  'ellev', 'elpar', 'elparn', 'elcomp', 'elcompn', 'elweight', 'elispar', 'elisanc',
  'attrs', 'attrn', 'attrsl', 'attrnl',
  'elementindex', 'elementname', 'elementtype', 'elementlevel',
  'elementcomponent', 'elementcomponentcount', 'elementparent', 'elementparentcount',
  'elementweight', 'elementisancestor', 'elementiscomponent',
  'elementattrs', 'elementattrn', 'elementattrsl', 'elementattrnl',
  'dimensionattrs', 'dimensionattrn', 'dimensionelementexists',
  'dimensionelementprincipalname', 'hierarchyelementprincipalname',
  'subsetgetsize', 'subsetgetelementname', 'subsetexists',
  'subsetelementexists', 'subsetelementgetindex', 'subsetmdxget',
]);

/** Static-analysis: every literal dimension name passed as the 1st arg to a
 *  dim-read builtin (see DIM_READ_FUNC_NAMES). */
export function detectLiteralDims(src: ProcessFetchResult): string[] {
  const dims = new Set<string>();
  for (const body of [src.prolog, src.metadata, src.data, src.epilog]) {
    eachCallDeep(body, (site) => {
      if (!DIM_READ_FUNC_NAMES.has(site.name.toLowerCase())) return;
      const args = splitArgs(site.argString);
      if (args.length < 1) return;
      const a = args[0].trim();
      if (a.length >= 2 && a.startsWith("'") && a.endsWith("'")) {
        dims.add(a.slice(1, -1).replace(/''/g, "'"));
      }
    });
  }
  return [...dims].sort();
}

export async function fetchCubeDims(cfg: Tm1Config, cube: string): Promise<string[]> {
  // Try the OData collection first; some TM1 versions only expose the
  // expand path on the Cube entity itself.
  const paths = [
    `Cubes('${encodeODataKey(cube)}')/Dimensions?$select=Name`,
    `Cubes('${encodeODataKey(cube)}')?$expand=Dimensions($select=Name)&$select=Name`,
  ];
  for (const p of paths) {
    try {
      const res = await apiRequest('GET', p, undefined, undefined, cfg);
      if (!isOk(res)) continue;
      const parsed = parseBody<{
        value?: { Name: string }[];
        Dimensions?: { Name: string }[];
      }>(res);
      const list = parsed.value ?? parsed.Dimensions ?? [];
      const names = list.map((d) => d.Name);
      if (names.length > 0) return names;
    } catch {
      /* try next path */
    }
  }
  return [];
}

/** Fetch elements (name + level) of a dimension. Tries the legacy
 *  `Dimensions('<dim>')/Elements` path first (works on TM1 11.x default
 *  hierarchies), falls back to `Hierarchies('<hier>')/Elements` for setups
 *  where the dim/hierarchy split is required. */
export async function fetchDimElements(
  cfg: Tm1Config,
  dim: string,
): Promise<{ name: string; level: number; children?: string[] }[]> {
  const select = '$select=Name,Level&$expand=Components($select=Name)';
  const paths = [
    `Dimensions('${encodeODataKey(dim)}')/Elements?${select}`,
    `Dimensions('${encodeODataKey(dim)}')/Hierarchies('${encodeODataKey(dim)}')/Elements?${select}`,
    `Dimensions('${encodeODataKey(dim)}')/DefaultHierarchy/Elements?${select}`,
  ];
  for (const p of paths) {
    try {
      const res = await apiRequest('GET', p, undefined, undefined, cfg);
      if (!isOk(res)) continue;
      const parsed = parseBody<{
        value?: { Name: string; Level: number; Components?: { Name: string }[] }[];
      }>(res);
      const elems = (parsed.value ?? []).map((e) => {
        const out: { name: string; level: number; children?: string[] } = {
          name: e.Name,
          level: Number(e.Level) || 0,
        };
        if (e.Components && e.Components.length > 0) {
          out.children = e.Components.map((c) => c.Name);
        }
        return out;
      });
      if (elems.length > 0) return elems;
    } catch {
      /* try next path */
    }
  }
  return [];
}

/** Fetch per-element attributes of a dimension as `{ <elem>: { <attr>: value } }`.
 *  Attributes is a TM1 Complex-Type → must be pulled via `$select` (an `$expand`
 *  returns HTTP 400 on strict servers); the value arrives as an `{attr: value}`
 *  object per element. Only string/number attribute values are kept. */
export async function fetchDimAttributes(
  cfg: Tm1Config,
  dim: string,
): Promise<Record<string, Record<string, string | number>>> {
  const out: Record<string, Record<string, string | number>> = {};
  const encDim = encodeODataKey(dim);

  // Alias-type attributes: REST `$select=Attributes` returns the ELEMENT NAME as
  // a fallback for an UNSET alias, but TI ATTRS returns '' for those. Collect the
  // alias names so we can drop values that merely echo the element name (see
  // below) — otherwise the simulator reports a fake alias where TI has none.
  // `Caption` is the synthetic principal caption and behaves the same way.
  const aliasNames = new Set<string>(['Caption']);
  for (const ap of [
    `Dimensions('${encDim}')/Hierarchies('${encDim}')/ElementAttributes`,
    `Dimensions('${encDim}')/ElementAttributes`,
  ]) {
    try {
      const res = await apiRequest('GET', ap, undefined, undefined, cfg);
      if (!isOk(res)) continue;
      const parsed = parseBody<{ value?: { Name: string; Type: string }[] }>(res);
      const rows = parsed.value ?? [];
      if (rows.length === 0) continue;
      for (const a of rows) {
        if (String(a.Type).toLowerCase() === 'alias') aliasNames.add(a.Name);
      }
      break;
    } catch {
      /* try next path */
    }
  }

  const select = '$select=Name,Attributes';
  const paths = [
    `Dimensions('${encDim}')/Hierarchies('${encDim}')/Elements?${select}`,
    `Dimensions('${encDim}')/Elements?${select}`,
  ];
  for (const p of paths) {
    try {
      const res = await apiRequest('GET', p, undefined, undefined, cfg);
      if (!isOk(res)) continue;
      const parsed = parseBody<{
        value?: { Name: string; Attributes?: Record<string, unknown> }[];
      }>(res);
      const rows = parsed.value ?? [];
      if (rows.length === 0) continue;
      for (const e of rows) {
        const attrs = e.Attributes;
        if (!attrs || typeof attrs !== 'object') continue;
        const map: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(attrs)) {
          if (typeof v !== 'string' && typeof v !== 'number') continue;
          // Drop an unset-alias fallback (value === element name) so ATTRS on an
          // element with no alias returns '' like TI does.
          if (aliasNames.has(k) && v === e.Name) continue;
          map[k] = v;
        }
        if (Object.keys(map).length > 0) out[e.Name] = map;
      }
      return out;
    } catch {
      /* try next path */
    }
  }
  return out;
}

export type FixtureBundle = {
  cubeDims: Record<string, string[]>;
  dimFixtures: Record<string, { elements: { name: string; level: number; children?: string[] }[] }>;
  dimAttrs: Record<string, Record<string, Record<string, string | number>>>;
};

/** Build the simulator fixture bundle (cube-dims + dim elements + dim attributes)
 *  for the given probe process(es). Dimensions are gathered BOTH from literal cube
 *  targets (→ their dim list) AND from direct dim-read calls (DIMIX/ATTRS/…), so
 *  dimensions referenced only through the latter still get element+attribute data.
 *  Attributes are fetched only for the directly-referenced dims (attr reads always
 *  name their dim literally) to avoid pulling attributes for large cube dims. */
export async function buildFixtureBundle(
  cfg: Tm1Config,
  probes: ProcessFetchResult[],
  extraCubes: string[] = [],
): Promise<FixtureBundle> {
  const cubeDims: FixtureBundle['cubeDims'] = {};
  const dimFixtures: FixtureBundle['dimFixtures'] = {};
  const dimAttrs: FixtureBundle['dimAttrs'] = {};
  const dimsToFetch = new Set<string>();
  const literalDims = new Set<string>();
  const addCube = async (cube: string): Promise<void> => {
    if (cubeDims[cube]) return;
    cubeDims[cube] = await fetchCubeDims(cfg, cube);
    for (const d of cubeDims[cube]) dimsToFetch.add(d);
  };
  for (const probe of probes) {
    for (const cube of detectLiteralCubes(probe)) await addCube(cube);
    for (const dim of detectLiteralDims(probe)) {
      dimsToFetch.add(dim);
      literalDims.add(dim);
    }
  }
  for (const cube of extraCubes) await addCube(cube);
  for (const dim of dimsToFetch) {
    dimFixtures[dim] = { elements: await fetchDimElements(cfg, dim) };
  }
  for (const dim of literalDims) {
    const a = await fetchDimAttributes(cfg, dim);
    if (Object.keys(a).length > 0) dimAttrs[dim] = a;
  }
  return { cubeDims, dimFixtures, dimAttrs };
}

export async function fetchProcessForCapture(
  cfg: Tm1Config,
  processName: string,
): Promise<ProcessFetchResult> {
  const select =
    'PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure,DataSource,Parameters,Variables';
  const res = await apiRequest(
    'GET',
    `Processes('${encodeODataKey(processName)}')?$select=${select}`,
    undefined,
    undefined,
    cfg,
  );
  if (!isOk(res)) {
    throw new Tm1HttpError(`fetch process '${processName}': HTTP ${res.statusCode}`, res.statusCode);
  }
  const d = parseBody<{
    PrologProcedure?: string;
    MetadataProcedure?: string;
    DataProcedure?: string;
    EpilogProcedure?: string;
    DataSource?: { Type: string; [k: string]: unknown };
    Parameters?: { Name: string; Type: string; Value?: string | number; Prompt?: string }[];
    Variables?: {
      Name: string;
      Type: string;
      Position: number;
      StartByte: number;
      EndByte: number;
    }[];
  }>(res);
  return {
    prolog: (d.PrologProcedure ?? '').replace(/\r\n/g, '\n'),
    metadata: (d.MetadataProcedure ?? '').replace(/\r\n/g, '\n'),
    data: (d.DataProcedure ?? '').replace(/\r\n/g, '\n'),
    epilog: (d.EpilogProcedure ?? '').replace(/\r\n/g, '\n'),
    datasource: d.DataSource ?? { Type: 'None' },
    parameters: (d.Parameters ?? []).map((p) => ({
      Name: p.Name,
      Type: p.Type === 'String' ? 'String' : 'Numeric',
      Value: p.Value,
      Prompt: p.Prompt,
    })),
    variables: (d.Variables ?? []).map((v) => ({
      Name: v.Name,
      Type: v.Type === 'String' ? 'String' : 'Numeric',
      Position: v.Position,
      StartByte: v.StartByte,
      EndByte: v.EndByte,
    })),
  };
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect `ExecuteProcess` / `ExecuteCommand` calls in any of the four TI sections.
 * Returns a per-call list with section + 1-based line + the captured call name.
 */
export const SUB_PROCESS_CALL_NAMES: ReadonlySet<string> = new Set([
  'executeprocess',
  'executecommand',
]);

export function scanSubProcessCalls(
  src: { prolog: string; metadata: string; data: string; epilog: string },
): { section: 'prolog' | 'metadata' | 'data' | 'epilog'; call: string; line: number }[] {
  const out: {
    section: 'prolog' | 'metadata' | 'data' | 'epilog';
    call: string;
    line: number;
  }[] = [];
  for (const s of ['prolog', 'metadata', 'data', 'epilog'] as const) {
    const body = src[s];
    if (!body) continue;
    for (const site of findCallSites(body)) {
      if (!SUB_PROCESS_CALL_NAMES.has(site.name.toLowerCase())) continue;
      const { line } = offsetToLineCol(body, site.start);
      out.push({ section: s, call: site.name, line });
    }
  }
  return out;
}

/** Quick-pick a connected TM1 server, auto-selecting if exactly one is connected. */
export async function pickConnectedServer(
  deps: CommandDeps,
): Promise<{ cfg: Tm1Config; serverName: string } | undefined> {
  const ids = await getConnectedIdsRestored();
  if (ids.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('Connect to a TM1 server first.'));
    return undefined;
  }
  if (ids.length === 1) {
    const cfg = deps.getConfigByServerId(ids[0]);
    if (!cfg) {
      vscode.window.showErrorMessage(vscode.l10n.t('Server config not found.'));
      return undefined;
    }
    return cfg;
  }
  type Item = vscode.QuickPickItem & { _id: string };
  const items: Item[] = ids
    .map((id) => {
      const c = deps.getConfigByServerId(id);
      return c ? ({ label: c.serverName, _id: id } as Item) : undefined;
    })
    .filter((x): x is Item => x !== undefined);
  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Select source server'),
    placeHolder: vscode.l10n.t('Multiple servers connected — select source'),
    ignoreFocusOut: true,
  });
  if (!pick) return undefined;
  return deps.getConfigByServerId(pick._id);
}
