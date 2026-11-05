import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { type RunSections } from '../../tiSimulator/runner/processRunner';
import { readCsv } from '../../tiSimulator/source/csvSource';
import { parseLog } from '../../tiTestFramework/log/logParser';
import type { Value, Fixtures, DimElement } from '../../tiSimulator/types';
import { emptyFixtures, cubeCellKey, attrKey } from '../../tiSimulator/types';
import type { SubProcessModule } from '../../tiSimulator/eval/subProcess';
import { fileExists } from './helpers';

/**
 * Resolves a per-test data file. New layout uses a single `data/` folder;
 * legacy tests still have `input/` + `expected/`. Prefer the new path,
 * fall back to legacy for back-compat.
 */
export async function resolveDataFile(
  testFolder: string,
  filename: string,
  legacyFolder: 'input' | 'expected',
): Promise<string | undefined> {
  const newPath = path.join(testFolder, 'data', filename);
  if (await fileExists(newPath)) return newPath;
  const legacyPath = path.join(testFolder, legacyFolder, filename);
  if (await fileExists(legacyPath)) return legacyPath;
  return undefined;
}

/** Returns existing data dir (data/ if present, else legacy input/expected). */
export async function resolveDataDir(
  testFolder: string,
  legacyFolder: 'input' | 'expected',
): Promise<string> {
  const data = path.join(testFolder, 'data');
  if (await fileExists(data)) return data;
  return path.join(testFolder, legacyFolder);
}

export async function loadFixtures(testFolder: string): Promise<Fixtures> {
  const fx = emptyFixtures();
  const dimPath = await resolveDataFile(testFolder, 'dim-fixtures.json', 'input');
  if (dimPath) {
    try {
      const raw = await fs.readFile(dimPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, { elements: DimElement[] }>;
      for (const [dim, info] of Object.entries(parsed)) {
        if (info && Array.isArray(info.elements)) {
          fx.dimensions.set(
            dim,
            info.elements.map((e) => {
              const out: DimElement = { name: String(e.name), level: Number(e.level) || 0 };
              if (Array.isArray(e.children) && e.children.length > 0) {
                out.children = e.children.map((c) => String(c));
              }
              return out;
            }),
          );
        }
      }
    } catch {
      /* ignore malformed dim-fixtures */
    }
  }
  const cubePath = await resolveDataFile(testFolder, 'cube-fixtures.jsonl', 'input');
  if (cubePath) {
    try {
      const raw = await fs.readFile(cubePath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const row = JSON.parse(t) as { cube?: string; coord?: string[]; value?: Value };
        if (typeof row.cube === 'string' && Array.isArray(row.coord) && row.value !== undefined) {
          fx.cubeCells.set(cubeCellKey(row.cube, row.coord.map(String)), row.value);
        }
      }
    } catch {
      /* ignore malformed cube-fixtures */
    }
  }

  // attr-reads.jsonl: one { fn, args[], value } per line — object-level attribute
  // reads (CubeAttrS, HierarchyAttrN, ProcessAttrSL, …) resolved from capture.
  // Key = `<fn.toLowerCase()>\t<arg1>\t…\t<argN>` (matches objectAttrRead.ts).
  const attrReadsPath = await resolveDataFile(testFolder, 'attr-reads.jsonl', 'input');
  if (attrReadsPath) {
    try {
      const raw = await fs.readFile(attrReadsPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const row = JSON.parse(t) as { fn?: string; args?: Value[]; value?: Value };
        if (typeof row.fn === 'string' && Array.isArray(row.args) && row.value !== undefined) {
          fx.objectAttributes!.set(
            `${row.fn.toLowerCase()}\t${row.args.map(String).join('\t')}`,
            row.value,
          );
        }
      }
    } catch {
      /* ignore malformed attr-reads */
    }
  }

  // cube-dims.json: { "<cube>": ["<dim1>", "<dim2>", ...] } — used by TabDim()
  // so bedrock-style export processes can iterate the cube's dim list.
  const cubeDimsPath = await resolveDataFile(testFolder, 'cube-dims.json', 'input');
  if (cubeDimsPath) {
    try {
      const raw = await fs.readFile(cubeDimsPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (parsed && typeof parsed === 'object') {
        for (const [cube, dims] of Object.entries(parsed)) {
          if (Array.isArray(dims)) {
            fx.cubeDims.set(cube, dims.map(String));
          }
        }
      }
    } catch {
      /* ignore malformed cube-dims */
    }
  }

  // dim-attributes.json: { "<dim>": { "<elem>": { "<attr>": value } } }
  const attrPath = await resolveDataFile(testFolder, 'dim-attributes.json', 'input');
  if (attrPath) {
    try {
      const raw = await fs.readFile(attrPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, Record<string, Record<string, Value>>>;
      for (const [dim, elems] of Object.entries(parsed ?? {})) {
        if (!elems || typeof elems !== 'object') continue;
        for (const [elem, attrs] of Object.entries(elems)) {
          if (!attrs || typeof attrs !== 'object') continue;
          for (const [attr, val] of Object.entries(attrs)) {
            if (typeof val === 'number' || typeof val === 'string') {
              fx.attributes.set(attrKey(dim, elem, attr), val);
            }
          }
        }
      }
    } catch {
      /* ignore malformed dim-attributes */
    }
  }
  return fx;
}

export async function loadCubeDims(testFolder: string): Promise<Record<string, string[]>> {
  const p = await resolveDataFile(testFolder, 'cube-dims.json', 'input');
  if (!p) return {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v) && v.every((s) => typeof s === 'string')) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Scan every `*_log.txt` in the test's data folder for a `__CALL__` marker
 * targeting `subName`. Overlay the captured pName/pValue pairs from the
 * first match into `parameters` (so design defaults like pCube='' get
 * replaced with the value the LIVE parent process actually passed).
 *
 * No-op if no marker is found — caller falls back to design defaults.
 */
export async function overlayCallParams(
  dataDir: string,
  subName: string,
  parameters: Record<string, Value>,
): Promise<void> {
  let entries: { name: string; isFile: () => boolean }[] = [];
  try {
    entries = await fs.readdir(dataDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isFile() || !/_log\.txt$/i.test(e.name)) continue;
    try {
      const text = await fs.readFile(path.join(dataDir, e.name), 'utf8');
      const rows = parseLog(text).rows;
      for (const r of rows) {
        if (r.op !== '__CALL__') continue;
        const callRow = r as { op: '__CALL__'; callee: string; callIndex: number; params: Array<[string, string]> };
        if (callRow.callee !== subName) continue;
        for (const [pName, pValue] of callRow.params) {
          // Captured value wins over design default.
          const asNum = Number(pValue);
          parameters[pName] = Number.isFinite(asNum) && pValue !== '' ? asNum : pValue;
        }
        return; // first hit wins
      }
    } catch {
      /* skip unreadable log */
    }
  }
}

export async function loadVariableNames(testFolder: string): Promise<string[] | undefined> {
  const p = await resolveDataFile(testFolder, 'variables.json', 'input');
  if (!p) return undefined;
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as { Name: string }[];
    if (!Array.isArray(parsed)) return undefined;
    return parsed.map((e) => e.Name).filter((n) => typeof n === 'string');
  } catch {
    return undefined;
  }
}

export async function loadParameters(testFolder: string): Promise<Record<string, Value>> {
  const p = await resolveDataFile(testFolder, 'parameters.json', 'input');
  if (!p) return {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as { Name: string; Value: Value }[];
    if (!Array.isArray(parsed)) return {};
    const out: Record<string, Value> = {};
    for (const e of parsed) {
      if (e && typeof e.Name === 'string') out[e.Name] = e.Value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Phase 2.5: pre-load sub-process modules from disk. For each declared sub
 * (manifest.subs[]) that has a corresponding `data/<sub>.ti` file, parse the
 * #region markers + read `data/<sub>.parameters.json` for parameter names.
 *
 * Returns a Map of name → module. Subs without a source file are absent —
 * the caller falls back to log-merge for those.
 */
export async function loadSubModules(testFolder: string, subNames: string[]): Promise<Map<string, SubProcessModule>> {
  const result = new Map<string, SubProcessModule>();
  const dataDir = path.join(testFolder, 'data');
  for (const name of subNames) {
    const tiPath = path.join(dataDir, `${name}.ti`);
    if (!(await fileExists(tiPath))) continue;
    try {
      const src = await fs.readFile(tiPath, 'utf8');
      const sections = splitWithMarkersOrAll(src);
      const paramPath = path.join(dataDir, `${name}.parameters.json`);
      let parameterNames: string[] = [];
      if (await fileExists(paramPath)) {
        try {
          const raw = await fs.readFile(paramPath, 'utf8');
          const parsed = JSON.parse(raw) as { Name?: string }[];
          if (Array.isArray(parsed)) {
            parameterNames = parsed.map((p) => p?.Name ?? '').filter((n) => n.length > 0);
          }
        } catch {
          /* missing/malformed params → empty names list */
        }
      }
      // Captured DataSource rows + column variable names — enables sub's
      // data section to iterate row-by-row like the parent simulator.
      const subModule: SubProcessModule = { sections, parameterNames };
      const sourcePath = path.join(dataDir, `${name}_source.txt`);
      if (await fileExists(sourcePath)) {
        try {
          subModule.source = await readCsv(sourcePath);
        } catch {
          /* unreadable source — sub runs without iteration */
        }
      }
      const varsPath = path.join(dataDir, `${name}.variables.json`);
      if (await fileExists(varsPath)) {
        try {
          const raw = await fs.readFile(varsPath, 'utf8');
          const parsed = JSON.parse(raw) as { Name?: string }[];
          if (Array.isArray(parsed)) {
            // TM1 appends `NValue`, `SValue`, `value_is_string` per row when the
            // process has a cube-view DataSource. The capture helper's source
            // dump writes these as 3 extra columns past the declared vars (see
            // skeleton.ts sourceDumpStmt) so we mirror the names here for
            // rowBindings to alias them in the sub's data scope.
            subModule.variableNames = [
              ...parsed.map((v) => v?.Name ?? '').filter((n) => n.length > 0),
              'NValue', 'SValue', 'value_is_string',
            ];
          }
        } catch {
          /* missing/malformed variables — fall back to positional binding off */
        }
      }
      result.set(name, subModule);
    } catch {
      /* unreadable .ti file → skip; falls back to log-merge */
    }
  }
  return result;
}

export async function loadProcessSections(testFolder: string): Promise<RunSections | undefined> {
  const single = await resolveDataFile(testFolder, 'process.ti', 'input');
  if (single) {
    const txt = await fs.readFile(single, 'utf8');
    return splitWithMarkersOrAll(txt);
  }
  const dir = await resolveDataDir(testFolder, 'input');
  const sections: RunSections = { prolog: '', metadata: '', data: '', epilog: '' };
  let any = false;
  for (const k of ['prolog', 'metadata', 'data', 'epilog'] as const) {
    const p = path.join(dir, `${k}.ti`);
    if (await fileExists(p)) {
      sections[k] = await fs.readFile(p, 'utf8');
      any = true;
    }
  }
  return any ? sections : undefined;
}

export function splitWithMarkersOrAll(text: string): RunSections {
  const sections: RunSections = { prolog: '', metadata: '', data: '', epilog: '' };
  const startRe = /^\s*#region\s+(\w+)\s*$/;
  const endRe = /^\s*#endregion\s+(\w+)\s*$/;
  const lines = text.split('\n');
  let cur: keyof RunSections | null = null;
  let buf: string[] = [];
  let sawAnyRegion = false;
  for (const line of lines) {
    if (cur !== null) {
      const em = line.match(endRe);
      if (em && em[1] === cur) {
        sections[cur] = buf.join('\n');
        cur = null;
        buf = [];
        continue;
      }
      buf.push(line);
      continue;
    }
    const sm = line.match(startRe);
    if (
      sm &&
      (sm[1] === 'prolog' || sm[1] === 'metadata' || sm[1] === 'data' || sm[1] === 'epilog')
    ) {
      cur = sm[1];
      buf = [];
      sawAnyRegion = true;
    }
  }
  if (!sawAnyRegion) {
    sections.data = text;
  }
  return sections;
}

/**
 * Locate the source-data file. Priority: input/source.csv (if present and
 * non-trivial after stripping comment lines), else any *_source.dat or
 * *.dat file dropped into input/ by the user (helper output).
 */
export async function pickSourceFile(testFolder: string): Promise<string | undefined> {
  const dir = await resolveDataDir(testFolder, 'input');
  // The single-process capture helper writes `<process>_source.txt` from the
  // live run — that's authoritative when present. Prefer it over the legacy
  // synthetic `source.csv` which is only used as a Phase-1 fallback.
  let entries: { name: string; isFile: () => boolean }[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const capturedSource = entries.find(
    (e) => e.isFile() && /_source\.(txt|dat)$/i.test(e.name),
  );
  if (capturedSource) return path.join(dir, capturedSource.name);
  // Phase-1 / manual fallback: source.csv (skip if only comments).
  const csv = path.join(dir, 'source.csv');
  if (await fileExists(csv)) {
    const txt = await fs.readFile(csv, 'utf8');
    const meaningful = txt
      .split(/\r?\n/)
      .filter((l) => l.length > 0 && !l.trimStart().startsWith('#'));
    if (meaningful.length > 0) return csv;
  }
  const anyExport = entries.find((e) => e.isFile() && /\.(txt|dat)$/i.test(e.name) && !/^source\.csv$/i.test(e.name));
  if (anyExport) return path.join(dir, anyExport.name);
  return undefined;
}
