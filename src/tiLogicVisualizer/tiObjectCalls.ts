// Shared scanner for TI calls that name a cube, dimension or process.
// Used by the server linter (tiServerLinter.ts) and the reference index
// (references/refExtract.ts). The scan is identical; how an argument is
// resolved to a name differs per caller and stays in the callback.
import { KNOWN_SIGNATURES } from './tiSignatures';
import { joinContinuationLines } from './tiParser';
import { neutralizeLine } from '../utils/tiLineText';

export type ObjectArgKind = 'cube' | 'dimension' | 'process';

function buildArgIdxMap(paramName: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const [key, sig] of KNOWN_SIGNATURES.entries()) {
    const i = sig.params.findIndex(p => p.name.toLowerCase() === paramName);
    if (i >= 0) { map.set(key, i); }
  }
  return map;
}

/** Lowercase function name → index of the arg that holds the object name (first match). */
export const OBJECT_ARG_IDX: Record<ObjectArgKind, Map<string, number>> = {
  cube:      buildArgIdxMap('cubename'),
  dimension: buildArgIdxMap('dimensionname'),
  process:   buildArgIdxMap('processname'),
};

/** Functions whose trailing args follow the (paramName, paramValue)* pair convention. */
export const PARAM_PAIR_FUNCS = new Set(['executeprocess', 'runprocess']);

const TRACKED_FUNCS = [...new Set([
  ...OBJECT_ARG_IDX.cube.keys(),
  ...OBJECT_ARG_IDX.dimension.keys(),
  ...OBJECT_ARG_IDX.process.keys(),
])];
const FUNC_RE = new RegExp(`\\b(${TRACKED_FUNCS.join('|')})\\s*\\(`, 'gi');

/**
 * Functions that CREATE a new object — the name argument need not exist yet,
 * so neither caller reports them.
 */
const SKIP_FUNCS = new Set([
  'dimensioncreate',
  'cubecreate',
  'hierarchycreate',
  'subsetcreate',
  'subsetcreatebymdx',
  'viewcreate',
  'viewcreatebymdx',
]);

const SECTION_MARKER_RE = /^57[2345],\d*$/;

/** Splits a comma-separated argument string, respecting nested parens and quotes. */
export function splitArgs(argsStr: string): string[] {
  if (!argsStr.trim()) { return []; }
  const args: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (const ch of argsStr) {
    if (ch === "'" && !inStr)      { inStr = true;  cur += ch; }
    else if (ch === "'" && inStr)  { inStr = false; cur += ch; }
    else if (!inStr && ch === '(') { depth++; cur += ch; }
    else if (!inStr && ch === ')') { depth--; cur += ch; }
    else if (!inStr && depth === 0 && ch === ',') { args.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  args.push(cur.trim());
  return args.filter(a => a !== '');
}

/**
 * Returns the content of a string literal arg (without quotes), or null if it
 * is not a simple quoted literal (variable, concat, etc.).
 */
export function extractStringLiteral(arg: string): string | null {
  const t = arg.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 3) {
    const inner = t.slice(1, -1);
    if (!inner.includes("'")) { return inner; } // reject 'A' || 'B' concats
  }
  return null;
}

export interface ObjectCall {
  lineIdx: number;
  /** Joined line (continuations merged onto the start line). */
  line: string;
  /** Function name in source casing. */
  funcName: string;
  funcLower: string;
  args: string[];
}

/**
 * Walks TI source and reports every call to a tracked function (create
 * functions excluded). Multi-line calls are merged onto their start line, so
 * line numbers stay stable. `onLine` runs once per code line BEFORE that
 * line's calls are reported (used for flow-sensitive variable tracking).
 */
export function scanObjectCalls(
  text: string,
  onCall: (call: ObjectCall) => void,
  onLine?: (line: string) => void,
): void {
  const lines = joinContinuationLines(text.split('\n').map(l => l.replace(/\r$/, '')));

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // Skip .pro section markers (e.g. "572,3") and blank lines
    if (SECTION_MARKER_RE.test(line.trim()) || line.trim() === '') { continue; }

    const neutralized = neutralizeLine(line);
    // Skip comment-only lines
    if (neutralized.trim() === '') { continue; }

    onLine?.(line);

    FUNC_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FUNC_RE.exec(neutralized)) !== null) {
      const funcLower = m[1].toLowerCase();
      const openParen = m.index + m[0].length - 1;

      // Walk neutralized text to find the matching close paren
      let depth = 1;
      let i = openParen + 1;
      while (i < neutralized.length && depth > 0) {
        if (neutralized[i] === '(')      { depth++; }
        else if (neutralized[i] === ')') { depth--; }
        i++;
      }
      if (depth !== 0) { continue; } // unmatched paren — skip
      if (SKIP_FUNCS.has(funcLower)) { continue; }

      // Args come from the original line; neutralized only gives positions.
      const args = splitArgs(line.slice(openParen + 1, i - 1));
      onCall({ lineIdx, line, funcName: m[1], funcLower, args });
    }
  }
}
