/**
 * Per-process variable environment.
 *
 * Classifies every assignment `var = expression;` as
 *   - literal    (string literal or numeric literal)
 *   - param      (reference to a process parameter, directly or via another local var that is a param)
 *   - datasource (reference to a DataSource variable, its value comes from the source data at runtime)
 *   - dynamic    (everything else — CellGet, concatenation, function calls, IF, loops)
 *
 * Multi-assignment (a var is assigned different values) → dynamic,
 * because the value at an arbitrary call site is no longer unambiguous.
 */

import { neutralizeLine } from '../utils/tiLineText';

/**
 * A TI assignment `Name = Value;` with an optional line comment.
 *
 * Until 2026-09-20 it stood FOUR times verbatim in the tree (`referenceIndex.ts`
 * three times, once here). It has a known edge case: a `#` INSIDE a string is
 * treated as the start of a comment, so `DataSourceNameForServer = 'Cube#1';`
 * is read as dynamic. As long as the regex stands four times, the fix would
 * have to happen four times — and exactly one copy would be forgotten.
 */
export const TI_ASSIGN_RE = /^\s*([A-Za-z_]\w*)\s*=\s*(.+?)\s*;?\s*(?:#.*)?$/;

export type TiVarType = 'Numeric' | 'String';

export type VarBinding =
  | { kind: 'literal'; value: string }                                               // resolved literal value (string content without quotes, or numeric text)
  | { kind: 'param'; paramName: string; paramType?: TiVarType }                      // value comes directly from a process parameter
  | { kind: 'datasource'; varName: string; varType: TiVarType }                      // value comes from a DataSource variable (one per processed row)
  | { kind: 'dynamic' };                                                             // cannot resolve (computed/IF/CellGet/concat/etc.)

export interface ProcessEnv {
  /** Parameter names of this process (lowercase). */
  paramsLc: Set<string>;
  /** Original-cased param names (for display). Map from lowercase → original. */
  paramOriginal: Map<string, string>;
  /** Parameter types (lowercase name → type). */
  paramTypes: Map<string, TiVarType>;
  /** DataSource variable names (lowercase → type + original casing). */
  datasourceVars: Map<string, { name: string; type: TiVarType }>;
  /** Local variable bindings (varname lowercase → resolved binding). */
  vars: Map<string, VarBinding>;
}

const NUMERIC_LITERAL_RE = /^-?\d+(?:\.\d+)?$/;
const IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

const SECTION_MARKER_RE = /^57[2345],\d*$/;

/**
 * Classify a single right-hand-side expression (no surrounding whitespace).
 * Only handles simple cases:
 *   'literal', 42, varName (→ lookup), paramName (→ param-ref), dsVarName (→ datasource-ref).
 * Everything else (function calls, concatenation `||`/`|`, arithmetic, IF, brackets) → dynamic.
 */
export function resolveExpression(expr: string, env: ProcessEnv): VarBinding {
  const e = expr.trim().replace(/;+$/, '').trim();

  // String literal
  const strLit = parseSingleQuoted(e);
  if (strLit !== null) { return { kind: 'literal', value: strLit }; }

  // Numeric literal
  if (NUMERIC_LITERAL_RE.test(e)) { return { kind: 'literal', value: e }; }

  // Bare identifier — could be param, a DataSource var, or a previously-assigned local var
  if (IDENTIFIER_RE.test(e)) {
    const lc = e.toLowerCase();
    if (env.paramsLc.has(lc)) {
      return {
        kind: 'param',
        paramName: env.paramOriginal.get(lc) ?? e,
        paramType: env.paramTypes.get(lc),
      };
    }
    const ds = env.datasourceVars.get(lc);
    if (ds) {
      return { kind: 'datasource', varName: ds.name, varType: ds.type };
    }
    const bound = env.vars.get(lc);
    if (bound) { return bound; }
    // Unknown identifier — treat as dynamic (could be a global, a later-assigned var, etc.)
    return { kind: 'dynamic' };
  }

  // String concatenation `a | 'b' | c` (TM1 uses `|`; `||` also tolerated).
  // Resolvable ONLY if every operand is a static literal (or a var bound to one).
  // Any param/datasource/dynamic operand carries a runtime value → whole = dynamic.
  const concatParts = splitTopLevelConcat(e);
  if (concatParts) {
    let out = '';
    for (const part of concatParts) {
      if (part === '') { return { kind: 'dynamic' }; }
      const b = resolveExpression(part, env);
      if (b.kind !== 'literal') { return { kind: 'dynamic' }; }
      out += b.value;
    }
    return { kind: 'literal', value: out };
  }

  return { kind: 'dynamic' };
}

/**
 * Parse a single-quoted TI string literal, unescaping the doubled apostrophe
 * `''` → `'`. Returns the decoded value, or null if `e` is not exactly one
 * well-formed literal (e.g. it contains a lone unescaped `'` before the closing
 * quote, as in `'a'|'b'` — a concat, handled by splitTopLevelConcat).
 */
function parseSingleQuoted(e: string): string | null {
  if (e.length < 2 || e[0] !== "'" || e[e.length - 1] !== "'") { return null; }
  let out = '';
  const end = e.length - 1;
  let i = 1;
  while (i < end) {
    if (e[i] === "'") {
      if (e[i + 1] === "'") { out += "'"; i += 2; continue; } // escaped ''
      return null; // lone quote before the terminator → not a single literal
    }
    out += e[i];
    i++;
  }
  return out;
}

/**
 * Split a RHS expression on top-level `|` concatenation operators, ignoring pipes
 * inside single-quoted string literals and collapsing runs of `|` (so `||` acts
 * as one separator). Returns null when no top-level pipe is present.
 */
function splitTopLevelConcat(e: string): string[] | null {
  const parts: string[] = [];
  let cur = '';
  let inStr = false;
  let sawPipe = false;
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    if (c === "'") { inStr = !inStr; cur += c; continue; }
    if (!inStr && c === '|') {
      sawPipe = true;
      while (e[i + 1] === '|') { i++; } // collapse `||`
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur.trim());
  return sawPipe ? parts : null;
}

export interface BuildEnvOptions {
  /** 0-based, exclusive upper line bound — the env is built only from lines `< stopAtLine`. */
  stopAtLine?: number;
  /** Typ-Informationen pro Parameter (Key: lowercase Name). */
  paramTypes?: Map<string, TiVarType>;
  /** DataSource variable definitions (come from the process object). */
  datasourceVars?: Array<{ name: string; type: TiVarType }>;
  /**
   * true: multiple assignments overwrite (last assignment wins) — for hover/resolver view,
   * where the user wants to see the current state at a specific line.
   * false (default): multiple assignments with different bindings are demoted to `dynamic` —
   * conservative variant for cross-process reference tracking.
   */
  lastAssignmentWins?: boolean;
  /**
   * true: flow-sensitive evaluation (treat IF/ELSEIF/ELSE blocks structurally; see `flowSensitiveEnv.ts`).
   * Only useful in combination with `lastAssignmentWins:true`. On parse errors it transparently
   * falls back to the flow-insensitive path.
   */
  flowSensitive?: boolean;
}

/**
 * Build a process env from TI text and the process's parameter names.
 * Processes assignments top-down; multi-assignments are demoted to dynamic.
 *
 * Overloads:
 *   buildProcessEnv(text, paramNames)
 *   buildProcessEnv(text, paramNames, stopAtLine)     — legacy positional
 *   buildProcessEnv(text, paramNames, options)
 */
export function buildProcessEnv(
  text: string,
  paramNames: string[],
  stopAtLineOrOptions?: number | BuildEnvOptions,
): ProcessEnv {
  const opts: BuildEnvOptions =
    typeof stopAtLineOrOptions === 'number'
      ? { stopAtLine: stopAtLineOrOptions }
      : (stopAtLineOrOptions ?? {});

  const paramsLc = new Set(paramNames.map(p => p.toLowerCase()));
  const paramOriginal = new Map(paramNames.map(p => [p.toLowerCase(), p] as const));
  const paramTypes = opts.paramTypes ?? new Map<string, TiVarType>();
  const datasourceVars = new Map<string, { name: string; type: TiVarType }>();
  for (const dv of opts.datasourceVars ?? []) {
    datasourceVars.set(dv.name.toLowerCase(), { name: dv.name, type: dv.type });
  }

  const env: ProcessEnv = { paramsLc, paramOriginal, paramTypes, datasourceVars, vars: new Map() };

  const assignedOnce = new Map<string, VarBinding>();
  const seen = new Set<string>();

  const lines = text.split('\n');
  const limit = opts.stopAtLine !== undefined ? Math.min(opts.stopAtLine, lines.length) : lines.length;

  for (let i = 0; i < limit; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, '');
    if (SECTION_MARKER_RE.test(line.trim()) || line.trim() === '') { continue; }

    // Skip comment-only lines
    if (neutralizeLine(line).trim() === '') { continue; }

    // Skip if line does not look like a pure assignment (contains `==` or similar comparisons in condition context)
    const m = TI_ASSIGN_RE.exec(line);
    if (!m) { continue; }
    const varName = m[1];
    const rhs = m[2];

    // Exclude cases where rhs starts with `=` (meaning `==` comparison) — already filtered by regex `=\s*(.+)` non-greedy
    // but `a == b` would match with varName='a' and rhs='= b'. Guard:
    if (rhs.startsWith('=')) { continue; }

    const lc = varName.toLowerCase();
    // Never shadow a param name as a local var — a param reference of itself stays a param
    if (paramsLc.has(lc)) { continue; }
    // DataSource vars are kept as such — a local assignment with the same name would be unusual,
    // we ignore it to keep the "origin from the DataSource" visible.
    if (datasourceVars.has(lc)) { continue; }

    const binding = resolveExpression(rhs, env);

    if (opts.lastAssignmentWins) {
      // The most recent assignment overrides — fits the view "value directly before line N".
      assignedOnce.set(lc, binding);
      env.vars.set(lc, binding);
    } else if (seen.has(lc)) {
      const prev = assignedOnce.get(lc);
      if (prev && !bindingsEqual(prev, binding)) {
        // Konservativ: Multi-Assign mit unterschiedlichen Bindungen → dynamic.
        assignedOnce.set(lc, { kind: 'dynamic' });
        env.vars.set(lc, { kind: 'dynamic' });
      }
      // else: identische Bindung, Zustand bleibt
    } else {
      seen.add(lc);
      assignedOnce.set(lc, binding);
      env.vars.set(lc, binding);
    }
  }

  return env;
}

export function bindingsEqual(a: VarBinding, b: VarBinding): boolean {
  if (a.kind !== b.kind) { return false; }
  if (a.kind === 'literal'    && b.kind === 'literal')    { return a.value === b.value; }
  if (a.kind === 'param'      && b.kind === 'param')      { return a.paramName.toLowerCase() === b.paramName.toLowerCase(); }
  if (a.kind === 'datasource' && b.kind === 'datasource') { return a.varName.toLowerCase() === b.varName.toLowerCase(); }
  return a.kind === 'dynamic';
}
