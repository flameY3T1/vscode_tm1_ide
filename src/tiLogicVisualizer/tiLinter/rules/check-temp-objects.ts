import { TiFunctionCall, TiStatement } from '../../types';
import { LintDiagnose } from '../../lintTypes';
import { LintOptions } from '../types';
import { collectFunctionCalls, stringLiteralInner } from '../helpers/calls';
import { isNumericLiteral, isStringLiteral } from '../helpers/expressions';

/**
 * Variable → resolved string-literal value (lowercased key). A value of `null`
 * marks an *ambiguous* variable (assigned a non-literal, or two different
 * literals) — it cannot be resolved and must not be treated as a literal.
 */
type VarLiterals = Map<string, string | null>;

/** Collect `var = '<literal>'` assignments (depth-first into IF/WHILE) into a resolution map. */
function collectVarLiterals(statements: TiStatement[], map: VarLiterals): void {
  for (const stmt of statements) {
    switch (stmt.type) {
      case 'assignment': {
        const key = stmt.variable.trim().toLowerCase();
        const expr = stmt.expression.trim();
        const val = isStringLiteral(expr) ? stringLiteralInner(expr) : null;
        if (map.has(key) && map.get(key) !== val) { map.set(key, null); } // conflicting → ambiguous
        else { map.set(key, val); }
        break;
      }
      case 'if':
        collectVarLiterals(stmt.thenBody, map);
        for (const c of stmt.elseIfClauses) { collectVarLiterals(c.body, map); }
        collectVarLiterals(stmt.elseBody, map);
        break;
      case 'while':
        collectVarLiterals(stmt.body, map);
        break;
      default: // other statements neither nest nor matter here
        break;
    }
  }
}

/** Resolve a token to its effective string value. `lit` = the value is a known string (literal or resolved variable). */
function resolveToken(token: string, vars: VarLiterals): { lit: boolean; val: string } {
  const t = token.trim();
  if (isStringLiteral(t)) { return { lit: true, val: stringLiteralInner(t) }; }
  const resolved = vars.get(t.toLowerCase());
  if (typeof resolved === 'string') { return { lit: true, val: resolved }; }
  return { lit: false, val: t };
}

/** Lowercase + (when whitespace-insensitive) strip all internal whitespace — mirrors TM1 name matching. */
function normName(s: string, wsInsensitive: boolean): string {
  const lc = s.toLowerCase();
  return wsInsensitive ? lc.replace(/\s+/g, '') : lc;
}

/**
 * Match two argument tokens after variable resolution. Two known strings match
 * on normalized value; a known string vs an unresolved variable never matches
 * (cannot be statically proven — preserves the original literal-vs-variable rule).
 */
function tokensMatchResolved(a: string, b: string, vars: VarLiterals, wsInsensitive: boolean): boolean {
  const ra = resolveToken(a, vars);
  const rb = resolveToken(b, vars);
  if (ra.lit !== rb.lit) { return false; }
  return normName(ra.val, wsInsensitive) === normName(rb.val, wsInsensitive);
}

/**
 * L4 — `temp-object-not-destroyed`: ViewCreate/ViewCreateByMDX/SubsetCreate/
 * SubsetCreateByMDX without a matching ViewDestroy/SubsetDestroy later in the
 * process → hint on the create line.
 *
 * - Matching: view → (cube, viewName) pair, subset → (dim, subsetName) pair;
 *   literal- or variable-token comparison (see tiTokensMatch).
 * - Exception: AsTemporary flag set (literal non-0) → no hint. A non-literal
 *   temp flag keeps the rule silent (cannot be statically decided).
 * - Cross-section: create in Prolog + destroy in Epilog is fine — later
 *   sections are searched via `options.futureAsts`.
 *
 * Temp-flag positions (tiSignatures):
 * - ViewCreate(Cube, View, AsTemporary?)            → arg 2
 * - SubsetCreate(Dim, Subset, AsTemporary?)         → arg 2
 * - ViewCreateByMDX(Cube, View, MDX, AsTemporary?)  → arg 3
 * - SubsetCreateByMDX(Subset, MDX, [Dim], [AsTemporary]) → last arg when numeric
 */
interface TempCreate {
  kind: 'view' | 'subset';
  /** Cube (view) / dimension (subset) token. Undefined → unknown (ByMDX short form). */
  container?: string;
  name: string;
  line: number;
}

interface TempDestroy {
  kind: 'view' | 'subset';
  container: string;
  name: string;
}

/** 'no' → candidate for the hint; 'yes'/'unknown' → silent. */
function tempState(tempArg: string | undefined): 'yes' | 'no' | 'unknown' {
  if (tempArg === undefined || tempArg.trim() === '') { return 'no'; }
  const t = tempArg.trim();
  if (isNumericLiteral(t)) { return Number(t) === 0 ? 'no' : 'yes'; }
  return 'unknown';
}

function parseCreate(call: TiFunctionCall): { create: TempCreate; temp: 'yes' | 'no' | 'unknown' } | undefined {
  const name = call.name.toLowerCase();
  const a = call.args.map(x => x.trim());
  switch (name) {
    case 'viewcreate':
      if (a.length < 2) { return undefined; }
      return { create: { kind: 'view', container: a[0], name: a[1], line: call.line }, temp: tempState(a[2]) };
    case 'viewcreatebymdx':
      if (a.length < 2) { return undefined; }
      return { create: { kind: 'view', container: a[0], name: a[1], line: call.line }, temp: tempState(a[3]) };
    case 'subsetcreate':
      if (a.length < 2) { return undefined; }
      return { create: { kind: 'subset', container: a[0], name: a[1], line: call.line }, temp: tempState(a[2]) };
    case 'subsetcreatebymdx': {
      if (a.length < 2) { return undefined; }
      // Overloads: (Sub, MDX) | (Sub, MDX, Dim) | (Sub, MDX, AsTemp) | (Sub, MDX, Dim, AsTemp)
      let container: string | undefined;
      let tempArg: string | undefined;
      if (a.length >= 4) {
        container = a[2];
        tempArg = a[3];
      } else if (a.length === 3) {
        if (isNumericLiteral(a[2])) { tempArg = a[2]; } else { container = a[2]; }
      }
      return { create: { kind: 'subset', container, name: a[0], line: call.line }, temp: tempState(tempArg) };
    }
    default:
      return undefined;
  }
}

function parseDestroy(call: TiFunctionCall): TempDestroy | undefined {
  const name = call.name.toLowerCase();
  if (name !== 'viewdestroy' && name !== 'subsetdestroy') { return undefined; }
  const a = call.args.map(x => x.trim());
  if (a.length < 2) { return undefined; }
  return { kind: name === 'viewdestroy' ? 'view' : 'subset', container: a[0], name: a[1] };
}

function destroyMatches(create: TempCreate, destroy: TempDestroy, vars: VarLiterals, wsInsensitive: boolean): boolean {
  if (create.kind !== destroy.kind) { return false; }
  if (!tokensMatchResolved(create.name, destroy.name, vars, wsInsensitive)) { return false; }
  // ByMDX short form without dimension argument: match on the subset name alone.
  if (create.container === undefined) { return true; }
  return tokensMatchResolved(create.container, destroy.container, vars, wsInsensitive);
}

export function checkTempObjects(
  ast: TiStatement[],
  options: LintOptions | undefined,
  diagnostics: LintDiagnose[],
): void {
  const calls = collectFunctionCalls(ast);
  if (calls.length === 0) { return; }

  // Resolve `var = '<literal>'` assignments across the current and all later
  // sections so a destroy that addresses its object via a variable (e.g.
  // `dim = 'DimX'; SubsetDestroy(dim, 'tmpSub')`) still pairs with its create.
  const vars: VarLiterals = new Map();
  collectVarLiterals(ast, vars);
  for (const sectionAst of options?.futureAsts ?? []) { collectVarLiterals(sectionAst, vars); }
  const wsInsensitive = options?.nameWhitespaceInsensitive !== false; // default on

  const futureDestroys: TempDestroy[] = (options?.futureAsts ?? [])
    .flatMap(sectionAst => collectFunctionCalls(sectionAst))
    .map(parseDestroy)
    .filter((d): d is TempDestroy => d !== undefined);

  for (let i = 0; i < calls.length; i++) {
    const parsed = parseCreate(calls[i]);
    if (!parsed || parsed.temp !== 'no') { continue; }

    const laterDestroys: TempDestroy[] = calls.slice(i + 1)
      .map(parseDestroy)
      .filter((d): d is TempDestroy => d !== undefined);
    const destroyed = [...laterDestroys, ...futureDestroys].some(d => destroyMatches(parsed.create, d, vars, wsInsensitive));

    if (!destroyed) {
      diagnostics.push({
        line: parsed.create.line,
        severity: 'hint',
        ruleId: 'temp-object-not-destroyed',
        messageKey: `{0} is created but never destroyed — use ViewDestroy/SubsetDestroy in the Epilog or set the temp flag.`,
        messageArgs: [parsed.create.name],
      });
    }
  }
}
