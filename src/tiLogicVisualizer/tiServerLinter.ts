import { RulesLintDiagnose, ApiRequestFn } from './rulesLinter';
import { escapeODataKey } from '../utils/odataKey';
import { parseBodySafe } from '../tm1Rest/parseRest';
import { isOk } from '../tm1Rest/httpError';
import { scanObjectCalls, extractStringLiteral, OBJECT_ARG_IDX, PARAM_PAIR_FUNCS, type ObjectArgKind } from './tiObjectCalls';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** FetchNames dependency — injected from tiDiagnosticsProvider to avoid circular imports. */
export type FetchNamesFn = (endpoint: string) => Promise<string[]>;

/**
 * Like extractStringLiteral, but also resolves simple variable references
 * via the supplied varLiterals map (lowercase varname → literal value).
 * Only simple identifiers (no dots, brackets) are resolved.
 */
function extractStringLiteralOrVar(arg: string, varLiterals: Map<string, string>): string | null {
  const lit = extractStringLiteral(arg);
  // Empty resolves to null: an empty cube/dim name is never a real object — it
  // typically comes from a dynamic var that was only init'd `x = ''` and then
  // rebuilt via concatenation (which we can't resolve). Validating it as `''`
  // produced false "Cube '' not found" warnings.
  if (lit !== null) { return lit.trim() === '' ? null : lit; }
  const trimmed = arg.trim();
  if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*$/.test(trimmed)) {
    const resolved = varLiterals.get(trimmed.toLowerCase());
    return resolved && resolved.trim() !== '' ? resolved : null;
  }
  return null;
}

/**
 * Scans the lines for simple single-assignment string literals:
 *   varName = 'value'
 * Variables assigned more than once (possibly to different values) are excluded
 * because the value is ambiguous at a given call site.
 */
function extractVariableLiterals(lines: string[]): Map<string, string> {
  const single = new Map<string, string>();
  const multi  = new Set<string>();
  // Matches: optional-indent  varname  =  'value'  optional-semicolon/comment
  const re = /^\s*([A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*)\s*=\s*'([^']*)'\s*;?\s*(?:#.*)?$/i;
  for (const rawLine of lines) {
    const m = re.exec(rawLine.replace(/\r$/, ''));
    if (!m) { continue; }
    const key = m[1].toLowerCase();
    if (single.has(key)) { multi.add(key); } else { single.set(key, m[2]); }
  }
  for (const k of multi) { single.delete(k); }
  return single;
}

// ─── Reference extraction ────────────────────────────────────────────────────

interface TiFuncRef {
  lineIndex: number;
  funcName: string;  // original casing from source
  name: string;      // extracted string literal (cube, dimension or process name)
  kind: 'cube' | 'dimension' | 'process';
  /**
   * Only for kind 'process' on ExecuteProcess/RunProcess: parameter NAMES passed
   * as string literals at the odd arg positions (1, 3, 5, …). Variables/expressions
   * at a name position are skipped (not validatable).
   */
  paramNames?: string[];
}

/**
 * Extracts all cube/dimension name references from TI source text.
 * @param varLiterals  Optional map of variable → string literal value for simple assignments
 *                     (e.g. `c = 'SalesCube'`). Variables are resolved when used as cube/dim args.
 */
export function extractTiFuncRefs(
  text: string,
  varLiterals: Map<string, string> = new Map(),
): TiFuncRef[] {
  const refs: TiFuncRef[] = [];
  scanObjectCalls(text, ({ lineIdx, funcName, funcLower, args }) => {
    for (const kind of ['cube', 'dimension', 'process'] as ObjectArgKind[]) {
      const idx = OBJECT_ARG_IDX[kind].get(funcLower);
      if (idx === undefined || idx >= args.length) { continue; }
      const literal = extractStringLiteralOrVar(args[idx], varLiterals);
      if (literal === null) { continue; }
      let paramNames: string[] | undefined;
      if (kind === 'process' && PARAM_PAIR_FUNCS.has(funcLower)) {
        // TI convention: ExecuteProcess('Name', 'pParam1', val1, 'pParam2', val2, …)
        // → args at odd positions after the process name are param NAMES.
        paramNames = [];
        for (let p = idx + 1; p < args.length; p += 2) {
          const pn = extractStringLiteral(args[p]);
          if (pn !== null && pn.trim() !== '') { paramNames.push(pn); }
        }
      }
      refs.push({ lineIndex: lineIdx, funcName, name: literal, kind, paramNames });
    }
  });
  return refs;
}

// ─── Async server linter ─────────────────────────────────────────────────────

/**
 * Validates TM1 object names (cube and dimension names) used as string literals
 * in known TI functions against an active TM1 server connection.
 *
 * Returns [] if the server is unreachable or no relevant references are found.
 * Severity is 'warning' (not 'error') — names may differ between environments.
 */
/** Names per `$filter` call when fetching parameter lists. */
const PARAM_FILTER_CHUNK = 20;

export async function lintTiServer(
  text: string,
  api: ApiRequestFn,
  fetchNames: FetchNamesFn,
  opts?: { nameWhitespaceInsensitive?: boolean },
  /**
   * Optional cache lookup for a process's parameter names (original casing in,
   * server param names out; undefined = cache miss). Wired by callers to the
   * 30s reference-index cache (`peekReferenceIndex().processParams`) so the
   * per-keystroke lint reuses already-fetched param defs instead of issuing a
   * GET per referenced process on every debounce. Never triggers a build.
   */
  cachedProcParams?: (procName: string) => string[] | undefined,
): Promise<RulesLintDiagnose[]> {
  // TM1 matches object/element names case- AND (by default) whitespace-insensitively:
  // 'Hallo Welt', 'HalloWelt' and 'hallowelt' all resolve to the same object. Normalize
  // both server names and source references the same way so spacing never yields a false
  // "not found". Set nameWhitespaceInsensitive:false to treat whitespace as significant.
  const wsInsensitive = opts?.nameWhitespaceInsensitive !== false;
  const norm = (n: string): string => {
    const lc = n.toLowerCase();
    return wsInsensitive ? lc.replace(/\s+/g, '') : lc;
  };
  const varLiterals = extractVariableLiterals(text.split('\n'));
  const refs = extractTiFuncRefs(text, varLiterals);
  if (refs.length === 0) { return []; }

  const hasCubeRefs = refs.some(r => r.kind === 'cube');
  const hasDimRefs  = refs.some(r => r.kind === 'dimension');
  const hasProcRefs = refs.some(r => r.kind === 'process');

  // Fetch known names in parallel — use the shared fetchNames cache (5-min TTL)
  const [knownCubes, knownDims, knownProcs] = await Promise.all([
    hasCubeRefs ? fetchNames('Cubes').catch(() => []) : Promise.resolve([]),
    hasDimRefs  ? fetchNames('Dimensions').catch(() => []) : Promise.resolve([]),
    hasProcRefs ? fetchNames('Processes').catch(() => []) : Promise.resolve([]),
  ]);

  // If the server returned nothing, skip validation (server might be offline)
  if (knownCubes.length === 0 && knownDims.length === 0 && knownProcs.length === 0) { return []; }

  const cubeSet = new Set(knownCubes.map(norm));
  const dimSet  = new Set(knownDims.map(norm));
  const procSet = new Set(knownProcs.map(norm));

  // S2 prep: fetch parameter definitions — only for processes that EXIST on the
  // server AND are called with at least one string-literal param name. One fetch
  // per process name (Map dedup); fetch/parse errors → skip param check silently.
  // `$filter=Name eq` compares exactly (measured 11.8: upper-cased name → 0 rows),
  // so the batch below asks for the server's own spelling, not the reference's.
  const serverName = new Map(knownProcs.map(n => [norm(n), n]));
  const procFetch = new Map<string, string>(); // normalized → server spelling
  for (const ref of refs) {
    if (ref.kind !== 'process' || !ref.paramNames || ref.paramNames.length === 0) { continue; }
    const lc = norm(ref.name);
    if (procSet.has(lc) && !procFetch.has(lc)) { procFetch.set(lc, serverName.get(lc) ?? ref.name); }
  }
  const procParams = new Map<string, string[]>(); // lowercase proc name → server param names
  // Serve from the reference-index cache first; only network-fetch the misses.
  const toFetch: Array<[string, string]> = [];
  for (const [lc, orig] of procFetch.entries()) {
    const cached = cachedProcParams?.(orig);
    if (cached) { procParams.set(lc, cached); } else { toFetch.push([lc, orig]); }
  }
  // One `$filter` call per chunk instead of one GET per process on every lint
  // pass: 30 processes took 3 ms as one call vs 21 ms as 30 parallel GETs
  // (11.8, 2026-10-27). Chunks keep the URL short for long names.
  const chunks: Array<Array<[string, string]>> = [];
  for (let i = 0; i < toFetch.length; i += PARAM_FILTER_CHUNK) { chunks.push(toFetch.slice(i, i + PARAM_FILTER_CHUNK)); }
  await Promise.all(chunks.map(async chunk => {
    try {
      const filter = chunk.map(([, name]) => `Name eq '${escapeODataKey(name)}'`).join(' or ');
      // `Parameters` is an OData complex type: $expand → HTTP 400 on strict servers, $select works.
      const res = await api('GET', `Processes?$select=Name,Parameters&$filter=${encodeURIComponent(filter)}`);
      if (!isOk(res)) { return; }
      const parsed = parseBodySafe<{ value?: Array<{ Name?: string; Parameters?: Array<{ Name?: string }> }> }>(res, {});
      for (const p of parsed.value ?? []) {
        const names = (p.Parameters ?? [])
          .map(x => String(x?.Name ?? ''))
          .filter(n => n !== '');
        procParams.set(norm(String(p.Name ?? '')), names);
      }
    } catch { /* network/parse error — skip param check for these processes */ }
  }));

  const diags: RulesLintDiagnose[] = [];

  // Deduplicate: only one warning per (line, kind, name) combination
  const seen = new Set<string>();

  for (const ref of refs) {
    const key = `${ref.lineIndex}:${ref.kind}:${norm(ref.name)}`;
    const firstSeen = !seen.has(key);
    seen.add(key);

    if (ref.kind === 'cube') {
      if (firstSeen && cubeSet.size > 0 && !cubeSet.has(norm(ref.name))) {
        diags.push({
          line: ref.lineIndex,
          messageKey: `Cube '{0}' was not found on the server (in {1}()).`,
          messageArgs: [ref.name, ref.funcName],
          severity: 'warning',
          ruleId: 'ti-unknown-cube',
        });
      }
    } else if (ref.kind === 'dimension') {
      if (firstSeen && dimSet.size > 0 && !dimSet.has(norm(ref.name))) {
        diags.push({
          line: ref.lineIndex,
          messageKey: `Dimension '{0}' was not found on the server (in {1}()).`,
          messageArgs: [ref.name, ref.funcName],
          severity: 'warning',
          ruleId: 'ti-unknown-dimension',
        });
      }
    } else if (ref.kind === 'process') {
      const lc = norm(ref.name);
      if (procSet.size > 0 && !procSet.has(lc)) {
        // S1: unknown process → no S2 param check (would be noise on top)
        if (firstSeen) {
          diags.push({
            line: ref.lineIndex,
            messageKey: `Process '{0}' was not found on the server (in {1}()).`,
            messageArgs: [ref.name, ref.funcName],
            severity: 'warning',
            ruleId: 'ti-unknown-process',
          });
        }
      } else if (procSet.has(lc) && ref.paramNames && ref.paramNames.length > 0) {
        // S2: process exists — validate literal param names (case-insensitive)
        const serverParams = procParams.get(lc);
        if (serverParams !== undefined) {
          const serverSet = new Set(serverParams.map(norm));
          for (const pName of ref.paramNames) {
            if (serverSet.has(norm(pName))) { continue; }
            const pKey = `${ref.lineIndex}:procparam:${lc}:${norm(pName)}`;
            if (seen.has(pKey)) { continue; }
            seen.add(pKey);
            diags.push({
              line: ref.lineIndex,
              messageKey: `Process '{0}' has no parameter '{1}' (available: {2}).`,
              messageArgs: [ref.name, pName, serverParams.join(', ')],
              severity: 'warning',
              ruleId: 'ti-wrong-process-params',
            });
          }
        }
      }
    }
  }

  return diags;
}
