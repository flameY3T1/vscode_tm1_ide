/**
 * Pure (vscode-free) evaluator for conditional-breakpoint expressions.
 *
 * Parses a TI boolean expression once and evaluates it against the live
 * variable values read from the debug frame. Unknown referenced variables and
 * parse/eval errors are reported as `{ ok: false }` so the caller can pause
 * fail-safe (an unevaluable condition must never silently skip a stop).
 */
import { parseExpression } from '../tiSimulator/ast/parseExpr';
import { evalExpr } from '../tiSimulator/eval/evalExpr';
import { Scope } from '../tiSimulator/eval/scope';
import type { Expr } from '../tiSimulator/ast/expr';
import { errMsg } from '../utils/errMsg';

export type CondResult = { ok: true; result: boolean } | { ok: false; error: string };

/** Collect variable-reference identifier names (not function names). */
function collectVarRefs(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case 'ident': out.add(e.name); break;
    case 'paren': collectVarRefs(e.inner, out); break;
    case 'unary': collectVarRefs(e.expr, out); break;
    case 'binary': collectVarRefs(e.left, out); collectVarRefs(e.right, out); break;
    case 'call': for (const a of e.args) { collectVarRefs(a, out); } break;
    default: break; // numLit / strLit: no refs
  }
}

function errText(e: unknown): string {
  return errMsg(e);
}

export function evalCondition(expr: string, vars: Record<string, string>): CondResult {
  let ast: Expr;
  try {
    ast = parseExpression(expr);
  } catch (e) {
    return { ok: false, error: `Syntax: ${errText(e)}` };
  }

  // Fail-safe: any referenced variable missing from the frame is an error
  // (evalExpr would otherwise silently substitute '' and evaluate falsy).
  const refs = new Set<string>();
  collectVarRefs(ast, refs);
  const known = new Set(Object.keys(vars).map((k) => k.toLowerCase()));
  for (const r of refs) {
    if (!known.has(r.toLowerCase())) {
      return { ok: false, error: `Unknown variable: ${r}` };
    }
  }

  const scope = new Scope();
  for (const [name, raw] of Object.entries(vars)) {
    const n = Number(raw);
    scope.set(name, raw.trim() !== '' && !Number.isNaN(n) ? n : raw);
  }

  let val: number | string;
  try {
    val = evalExpr(ast, scope);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }

  const num = typeof val === 'number' ? val : Number(val);
  const result = Number.isNaN(num) ? val !== '' : num !== 0;
  return { ok: true, result };
}

/**
 * Decide whether the debugger should stay paused at a breakpoint.
 * No condition → always pause. Error → pause fail-safe and surface the reason.
 */
export function shouldPause(
  condition: string | undefined,
  varRows: Array<{ name: string; value: string }>,
): { pause: boolean; error?: string } {
  if (!condition || condition.trim() === '') { return { pause: true }; }
  const vars: Record<string, string> = {};
  for (const v of varRows) { vars[v.name] = v.value; }
  const r = evalCondition(condition, vars);
  if (!r.ok) { return { pause: true, error: r.error }; }
  return { pause: r.result };
}

export type HitSpec =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'spec'; op: '=' | '>=' | '%'; n: number };

/** Parse a hit-count spec: `=N` / `>=N` / `%N` / bare `N` (→ `>=N`). Empty →
 *  `none`. Non-empty but unparseable or N < 1 → `invalid`. */
export function parseHitSpec(spec: string): HitSpec {
  const s = spec.trim();
  if (s === '') { return { kind: 'none' }; }
  const m = /^(>=|=|%)?\s*(\d+)$/.exec(s);
  if (!m) { return { kind: 'invalid' }; }
  const n = Number(m[2]);
  if (!Number.isInteger(n) || n < 1) { return { kind: 'invalid' }; }
  const op = (m[1] ?? '>=') as '=' | '>=' | '%';
  return { kind: 'spec', op, n };
}

/** Decide whether a breakpoint should pause given its hit-count spec and the
 *  current 1-based qualifying-hit count. Empty → always pass. Invalid → pause
 *  fail-safe with a reason. */
export function hitCountSatisfied(spec: string, hits: number): { pass: boolean; error?: string } {
  const parsed = parseHitSpec(spec);
  if (parsed.kind === 'none') { return { pass: true }; }
  if (parsed.kind === 'invalid') {
    return { pass: true, error: `Invalid hit count '${spec.trim()}' — use =N, >=N or %N.` };
  }
  const { op, n } = parsed;
  const pass = op === '=' ? hits === n : op === '%' ? hits % n === 0 : hits >= n;
  return { pass };
}

/** Pure per-stop breakpoint decision. Evaluates the expression first; on error
 *  pauses fail-safe WITHOUT counting. If the expression passes (or is absent)
 *  and a hit spec is set, advances the counter (qualifying stop) and applies the
 *  spec. Returns the new hit count so the caller can persist it. */
export function decideBreakpointStop(
  rule: { condition?: string; hitCondition?: string } | undefined,
  varRows: Array<{ name: string; value: string }>,
  priorHits: number,
): { pause: boolean; error?: string; newHits: number } {
  const cond = shouldPause(rule?.condition, varRows);
  if (!cond.pause) { return { pause: false, newHits: priorHits }; }
  if (cond.error) { return { pause: true, error: cond.error, newHits: priorHits }; }
  const hitSpec = rule?.hitCondition;
  if (!hitSpec) { return { pause: true, newHits: priorHits }; }
  const newHits = priorHits + 1;
  const hit = hitCountSatisfied(hitSpec, newHits);
  return { pause: hit.pass, error: hit.error, newHits };
}
