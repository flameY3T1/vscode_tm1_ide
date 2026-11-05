/**
 * Flow-sensitive variable environment.
 *
 * Supplement to `variableEnv.ts`: no longer builds the env rigidly top-down,
 * but evaluates IF/ELSEIF/ELSE blocks structurally.
 *
 * - The condition is checked against the current env with `evaluateCondition`.
 *   • `'true'`  → only the then-body takes effect
 *   • `'false'` → ELSEIFs and ELSE are walked through
 *   • `'unknown'` (condition depends on params/DS/dynamic) → all branches
 *     that come into question are executed against env copies, then combined
 *     with `mergeEnvs` (differing values → `dynamic`).
 *
 * WHILE is handled conservatively: the body runs once against a copy, merged
 * with the base (all variables written in the body with values that differ
 * from the base end up as `dynamic`).
 *
 * Uses the existing `parseTiCode` from `tiLogicVisualizer/tiParser/parse.ts`.
 * On parse errors (e.g. while the user is still typing) it transparently
 * falls back to the old flow-insensitive path (`buildProcessEnv` with
 * `lastAssignmentWins`).
 */

import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import type {
  TiStatement,
  TiIfBlock,
  TiWhileBlock,
} from '../tiLogicVisualizer/types';
import {
  bindingsEqual,
  buildProcessEnv,
  resolveExpression,
  type BuildEnvOptions,
  type ProcessEnv,
  type TiVarType,
  type VarBinding,
} from './variableEnv';

export type CondResult = 'true' | 'false' | 'unknown';

// ─── Condition-Evaluator ─────────────────────────────────────────────────────

/**
 * Evaluates a TI boolean expression against the given env.
 * Supports:
 *   - Comparisons: `=`, `<>`, `!=`, `<`, `>`, `<=`, `>=` (numeric)
 *                  `@=`, `@<>`, `@<`, `@>`, `@<=`, `@>=` (string)
 *   - Logical ops: `&` (AND), `|` (OR), `NOT(...)`
 *   - Parentheses
 *   - Truthy check on a single literal (`1` → true, `0` → false)
 *
 * If even a single operand cannot be resolved (dynamic/param/datasource), the
 * result is reported as `'unknown'`.
 */
export function evaluateCondition(expr: string, env: ProcessEnv): CondResult {
  const trimmed = (expr ?? '').trim();
  if (trimmed === '') { return 'unknown'; }

  try {
    const p = new CondParser(trimmed, env);
    const r = p.parseOr();
    if (!p.isAtEnd()) { return 'unknown'; }
    return r;
  } catch {
    return 'unknown';
  }
}

class CondParser {
  private pos = 0;
  constructor(private readonly text: string, private readonly env: ProcessEnv) {}

  parseOr(): CondResult {
    let left = this.parseAnd();
    while (this.consume('|')) {
      const right = this.parseAnd();
      left = logicalOr(left, right);
    }
    return left;
  }

  parseAnd(): CondResult {
    let left = this.parsePrimary();
    while (this.consume('&')) {
      const right = this.parsePrimary();
      left = logicalAnd(left, right);
    }
    return left;
  }

  parsePrimary(): CondResult {
    this.skipWs();
    if (this.peek() === '(') {
      this.pos++;
      const r = this.parseOr();
      this.skipWs();
      if (this.peek() !== ')') { throw new Error('Expected )'); }
      this.pos++;
      return r;
    }
    if (this.consumeWord('NOT')) {
      this.skipWs();
      if (this.peek() !== '(') { throw new Error('Expected ( after NOT'); }
      this.pos++;
      const r = this.parseOr();
      this.skipWs();
      if (this.peek() !== ')') { throw new Error('Expected )'); }
      this.pos++;
      return negate(r);
    }
    return this.parseComparison();
  }

  parseComparison(): CondResult {
    const left = this.parseValue();
    const op = this.consumeComparator();
    if (!op) {
      // Ohne Vergleichs-Op → Truthy-Check
      return toTruthy(left);
    }
    const right = this.parseValue();
    return compare(left, op, right);
  }

  parseValue(): VarBinding {
    this.skipWs();
    const ch = this.peek();
    if (ch === "'") {
      return this.readStringLit();
    }
    if (ch === '-' || (ch && /[0-9]/.test(ch))) {
      return this.readNumericLit();
    }
    if (ch && /[A-Za-zÄÖÜäöüß_]/.test(ch)) {
      return this.readIdentifierOrCall();
    }
    throw new Error(`Unexpected char at ${this.pos}: ${ch}`);
  }

  private readStringLit(): VarBinding {
    if (this.text[this.pos] !== "'") { throw new Error('Expected string literal'); }
    const start = this.pos;
    this.pos++;
    let value = '';
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === "'") {
        // Escaped `''` → literal apostrophe in TI-Strings
        if (this.text[this.pos + 1] === "'") {
          value += "'";
          this.pos += 2;
          continue;
        }
        this.pos++;
        return { kind: 'literal', value };
      }
      value += c;
      this.pos++;
    }
    throw new Error(`Unterminated string literal starting at ${start}`);
  }

  private readNumericLit(): VarBinding {
    const m = /^-?\d+(?:\.\d+)?/.exec(this.text.substring(this.pos));
    if (!m) { throw new Error('Expected numeric literal'); }
    this.pos += m[0].length;
    return { kind: 'literal', value: m[0] };
  }

  private readIdentifierOrCall(): VarBinding {
    const m = /^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*/.exec(this.text.substring(this.pos));
    if (!m) { throw new Error('Expected identifier'); }
    const name = m[0];
    this.pos += name.length;
    this.skipWs();
    // Function call? → dynamic (we do not simulate functions except condition-specific ones)
    if (this.peek() === '(') {
      this.skipBalancedParens();
      return { kind: 'dynamic' };
    }
    return resolveExpression(name, this.env);
  }

  private skipBalancedParens(): void {
    if (this.peek() !== '(') { return; }
    let depth = 0;
    while (this.pos < this.text.length) {
      const c = this.text[this.pos];
      if (c === "'") { this.readStringLit(); continue; }
      if (c === '(') { depth++; this.pos++; continue; }
      if (c === ')') {
        depth--;
        this.pos++;
        if (depth === 0) { return; }
        continue;
      }
      this.pos++;
    }
  }

  private peek(): string | undefined { return this.text[this.pos]; }

  private skipWs(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) { this.pos++; }
  }

  private consume(ch: string): boolean {
    this.skipWs();
    if (this.text.startsWith(ch, this.pos)) {
      this.pos += ch.length;
      return true;
    }
    return false;
  }

  private consumeWord(word: string): boolean {
    this.skipWs();
    const upper = this.text.substring(this.pos, this.pos + word.length).toUpperCase();
    if (upper !== word.toUpperCase()) { return false; }
    const after = this.text[this.pos + word.length];
    if (after !== undefined && /[A-Za-z0-9_]/.test(after)) { return false; }
    this.pos += word.length;
    return true;
  }

  private consumeComparator(): string | null {
    this.skipWs();
    // Check longer operators first so that `<=` is not mistaken for `<`.
    const ops = ['@<>', '@<=', '@>=', '@=', '@<', '@>', '<=', '>=', '<>', '!=', '=', '<', '>'];
    for (const op of ops) {
      if (this.text.startsWith(op, this.pos)) {
        this.pos += op.length;
        return op;
      }
    }
    return null;
  }

  isAtEnd(): boolean {
    this.skipWs();
    return this.pos >= this.text.length;
  }
}

function compare(left: VarBinding, op: string, right: VarBinding): CondResult {
  if (left.kind !== 'literal' || right.kind !== 'literal') { return 'unknown'; }
  const stringOp = op.startsWith('@');
  const bareOp = stringOp ? op.substring(1) : op;

  if (stringOp) {
    const l = left.value, r = right.value;
    switch (bareOp) {
      case '=':  return l === r ? 'true' : 'false';
      case '<>': return l !== r ? 'true' : 'false';
      case '<':  return l <  r ? 'true' : 'false';
      case '>':  return l >  r ? 'true' : 'false';
      case '<=': return l <= r ? 'true' : 'false';
      case '>=': return l >= r ? 'true' : 'false';
    }
    return 'unknown';
  }

  // Numerischer Vergleich: beide Literale als Zahlen interpretieren.
  const l = parseFloat(left.value);
  const r = parseFloat(right.value);
  if (isNaN(l) || isNaN(r)) {
    // Both strings but not numeric → string equal/not-equal is still defined
    if (bareOp === '=')  { return left.value === right.value ? 'true' : 'false'; }
    if (bareOp === '<>' || bareOp === '!=') { return left.value !== right.value ? 'true' : 'false'; }
    return 'unknown';
  }
  switch (bareOp) {
    case '=':  return l === r ? 'true' : 'false';
    case '<>':
    case '!=': return l !== r ? 'true' : 'false';
    case '<':  return l <  r ? 'true' : 'false';
    case '>':  return l >  r ? 'true' : 'false';
    case '<=': return l <= r ? 'true' : 'false';
    case '>=': return l >= r ? 'true' : 'false';
  }
  return 'unknown';
}

function toTruthy(v: VarBinding): CondResult {
  if (v.kind !== 'literal') { return 'unknown'; }
  const n = parseFloat(v.value);
  if (!isNaN(n)) { return n !== 0 ? 'true' : 'false'; }
  return v.value !== '' ? 'true' : 'false';
}

function logicalAnd(a: CondResult, b: CondResult): CondResult {
  if (a === 'false' || b === 'false') { return 'false'; }
  if (a === 'true' && b === 'true')    { return 'true'; }
  return 'unknown';
}

function logicalOr(a: CondResult, b: CondResult): CondResult {
  if (a === 'true'  || b === 'true')   { return 'true'; }
  if (a === 'false' && b === 'false')  { return 'false'; }
  return 'unknown';
}

function negate(c: CondResult): CondResult {
  if (c === 'true')  { return 'false'; }
  if (c === 'false') { return 'true'; }
  return 'unknown';
}

// ─── AST-Interpreter ────────────────────────────────────────────────────────

function cloneEnv(env: ProcessEnv): ProcessEnv {
  return {
    paramsLc:       env.paramsLc,
    paramOriginal:  env.paramOriginal,
    paramTypes:     env.paramTypes,
    datasourceVars: env.datasourceVars,
    vars:           new Map(env.vars),
  };
}

/**
 * Writes all `vars` from `src` into `dest` (in place).
 */
function copyVarsInto(dest: ProcessEnv, src: ProcessEnv): void {
  dest.vars.clear();
  for (const [k, v] of src.vars) { dest.vars.set(k, v); }
}

/**
 * Executes all statements sequentially. If `stopAtLine` is set, statements
 * with `line > stopAtLine` are skipped. If the stop line lies inside a block
 * statement, that block is navigated into (without merge, because we are
 * "inside the branch").
 */
function evalStatements(stmts: TiStatement[], env: ProcessEnv, stopAtLine?: number): void {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    if (stopAtLine !== undefined && stmt.line > stopAtLine) { return; }

    const nextSiblingLine = (i + 1 < stmts.length) ? stmts[i + 1].line : Infinity;
    const stopInThisBlock = stopAtLine !== undefined
      && stopAtLine >= stmt.line
      && stopAtLine < nextSiblingLine;

    if (stmt.type === 'assignment') {
      applyAssignment(stmt.variable, stmt.expression, env);
    } else if (stmt.type === 'if') {
      evalIfBlock(stmt, env, stopInThisBlock ? stopAtLine : undefined);
      if (stopInThisBlock) { return; }
    } else if (stmt.type === 'while') {
      evalWhileBlock(stmt, env, stopInThisBlock ? stopAtLine : undefined);
      if (stopInThisBlock) { return; }
    }
    // 'functionCall' → no env effect (for side effects we would have to
    // simulate function semantics — deliberately out of scope)
  }
}

function applyAssignment(varName: string, rhs: string, env: ProcessEnv): void {
  const lc = varName.toLowerCase();
  // Parameter and DataSource names are not overwritten as local vars
  if (env.paramsLc.has(lc))       { return; }
  if (env.datasourceVars.has(lc)) { return; }
  const binding = resolveExpression(rhs, env);
  env.vars.set(lc, binding);
}

/**
 * Evaluates an IF/ELSEIF/ELSE block.
 *
 * Strategy:
 *   1. Collect all clauses including thenBody as "leading".
 *   2. Walk through them in order; as soon as a condition is `true` →
 *      that body exclusively (subsequent ones drop out).
 *   3. Conditions that are `false` are skipped.
 *   4. For `unknown` the body is registered as a "possible" path.
 *   5. At the end — if no certain true clause was found — the ELSE body is
 *      registered as possible too.
 *   6. With exactly one certain path and no unknowns: apply directly.
 *      Otherwise: evaluate all possible paths against copies and merge.
 */
function evalIfBlock(ifB: TiIfBlock, env: ProcessEnv, stopAtLine?: number): void {
  // stopAtLine inside a concrete branch → navigate there directly (no merge)
  if (stopAtLine !== undefined) {
    const targetBody = findBranchContainingLine(ifB, stopAtLine);
    if (targetBody) {
      evalStatements(targetBody, env, stopAtLine);
      return;
    }
  }

  const clauses: Array<{ cond: string; body: TiStatement[] }> = [
    { cond: ifB.condition, body: ifB.thenBody },
    ...ifB.elseIfClauses.map(ei => ({ cond: ei.condition, body: ei.body })),
  ];

  const possibleBodies: TiStatement[][] = [];
  let foundTrue = false;
  let hasUnknown = false;

  for (const clause of clauses) {
    const c = evaluateCondition(clause.cond, env);
    if (c === 'true') {
      possibleBodies.push(clause.body);
      foundTrue = true;
      break;
    }
    if (c === 'unknown') {
      possibleBodies.push(clause.body);
      hasUnknown = true;
    }
    // 'false' → ignorieren
  }

  // The ELSE branch is reachable if no clause is certainly `true`.
  if (!foundTrue) {
    possibleBodies.push(ifB.elseBody);
  }

  if (!hasUnknown && foundTrue && possibleBodies.length === 1) {
    // Exactly one path certain → apply directly to `env`
    evalStatements(possibleBodies[0], env, stopAtLine);
    return;
  }

  if (!hasUnknown && !foundTrue && possibleBodies.length === 1) {
    // All clauses certainly false, only ELSE left → apply directly
    evalStatements(possibleBodies[0], env, stopAtLine);
    return;
  }

  // Several possible paths → evaluate against copies and merge
  const branchEnvs: ProcessEnv[] = possibleBodies.map(body => {
    const clone = cloneEnv(env);
    evalStatements(body, clone, undefined);
    return clone;
  });

  const merged = mergeEnvs(env, branchEnvs);
  copyVarsInto(env, merged);
}

function evalWhileBlock(wB: TiWhileBlock, env: ProcessEnv, stopAtLine?: number): void {
  if (stopAtLine !== undefined && stopAtLine >= wB.line && containsLine(wB.body, stopAtLine)) {
    // Target line lies in the WHILE body → we are inside; take the body directly
    evalStatements(wB.body, env, stopAtLine);
    return;
  }
  // Conservative: body once against a copy, merge with base
  //   (if the body never runs: base unchanged)
  const branch = cloneEnv(env);
  evalStatements(wB.body, branch, undefined);
  const merged = mergeEnvs(env, [env, branch]); // contains both paths: "loop ran 0×" and "loop ran"
  copyVarsInto(env, merged);
}

/**
 * Merges several env states. Variables that differ from the base in at least
 * one branch end up with the branch value (if all branches are identical) or
 * with `dynamic` (if they differ).
 */
function mergeEnvs(base: ProcessEnv, branches: ProcessEnv[]): ProcessEnv {
  const result = cloneEnv(base);

  const touched = new Set<string>();
  for (const b of branches) {
    for (const [k] of b.vars) { touched.add(k); }
    for (const [k] of base.vars) {
      if (!b.vars.has(k)) { touched.add(k); }
    }
  }

  for (const key of touched) {
    const bindings: VarBinding[] = branches.map(b => b.vars.get(key) ?? { kind: 'dynamic' as const });
    const first = bindings[0];
    const allEqual = bindings.every(b => bindingsEqual(b, first));
    result.vars.set(key, allEqual ? first : { kind: 'dynamic' });
  }

  return result;
}

/**
 * Checks whether `line` lies inside any statement in `stmts` (or recursively
 * in their blocks).
 */
function containsLine(stmts: TiStatement[], line: number): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];
    const nextSiblingLine = (i + 1 < stmts.length) ? stmts[i + 1].line : Infinity;
    if (line >= stmt.line && line < nextSiblingLine) { return true; }
  }
  return false;
}

/**
 * If `line` lies in a concrete branch (thenBody/elseIf/elseBody) of the IF
 * block, returns that branch body. Otherwise `null`.
 *
 * Algorithm: the non-empty branch bodies are sorted by their first statement
 * line. The branch with the largest firstLine ≤ line is the one that contains
 * the line (the successor branch begins at its firstLine with an ELSEIF/ELSE
 * marker one line before).
 */
function findBranchContainingLine(ifB: TiIfBlock, line: number): TiStatement[] | null {
  const branches: Array<{ body: TiStatement[]; firstLine: number }> = [];
  const pushIfNonEmpty = (body: TiStatement[]): void => {
    if (body.length > 0) { branches.push({ body, firstLine: body[0].line }); }
  };
  pushIfNonEmpty(ifB.thenBody);
  for (const ei of ifB.elseIfClauses) { pushIfNonEmpty(ei.body); }
  pushIfNonEmpty(ifB.elseBody);

  branches.sort((a, b) => a.firstLine - b.firstLine);
  for (let i = 0; i < branches.length; i++) {
    const start = branches[i].firstLine;
    const end   = (i + 1 < branches.length) ? branches[i + 1].firstLine - 1 : Infinity;
    if (line >= start && line <= end) { return branches[i].body; }
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Builds a ProcessEnv flow-sensitively: IF/ELSEIF/ELSE blocks are evaluated
 * structurally. On parse errors (e.g. while the user is typing) it falls back
 * to the flow-insensitive path.
 */
export function buildProcessEnvFlow(
  text: string,
  paramNames: string[],
  opts: BuildEnvOptions = {},
): ProcessEnv {
  const parse = parseTiCode(text);
  if (!parse.ok) {
    // Fallback: flow-insensitive with `lastAssignmentWins` (since this is the
    // currently desired mode for resolver/hover)
    return buildProcessEnv(text, paramNames, { ...opts, lastAssignmentWins: true });
  }

  const paramsLc = new Set(paramNames.map(p => p.toLowerCase()));
  const paramOriginal = new Map(paramNames.map(p => [p.toLowerCase(), p] as const));
  const paramTypes = opts.paramTypes ?? new Map<string, TiVarType>();
  const datasourceVars = new Map<string, { name: string; type: TiVarType }>();
  for (const dv of opts.datasourceVars ?? []) {
    datasourceVars.set(dv.name.toLowerCase(), { name: dv.name, type: dv.type });
  }

  const env: ProcessEnv = { paramsLc, paramOriginal, paramTypes, datasourceVars, vars: new Map() };
  evalStatements(parse.ast, env, opts.stopAtLine);
  return env;
}
