/**
 * Statement evaluator. Dispatches assignments to the scope and known
 * write-functions to the output collector. Unknown function-calls produce
 * a soft warning (not an error) so a process containing one Phase-β
 * builtin still runs the rest of its statements.
 */

import type { Statement } from '../ast/statement';
import type { Section, SimWarning, Value, Fixtures } from '../types';
import { Scope } from './scope';
import { evalExpr, EvalError } from './evalExpr';
import { findBuiltin } from './builtins';
import type { OutputCollector, CellOpName } from '../output/outputCollector';
import { buildOpRow } from '../output/opEmitter';
import { parseStatements } from '../ast/parseStatement';
import type { SubProcessLoader, SubProcessModule } from './subProcess';
import { rowBindings, type SourceRow } from '../source/csvSource';

const MAX_SUB_DEPTH = 16;

const CELL_WRITE_OPS: ReadonlySet<string> = new Set(['cellputn', 'cellputs', 'cellincrementn']);

const NOOP_STATEMENT_CALLS: ReadonlySet<string> = new Set([
  'executeprocess',
  'executecommand',
  'savedataall',
  'cubesavedata',
  'synchronized',
]);

/**
 * Calls that are silently ignored — declarative helpers whose semantics are
 * fully captured by the simulator's scope model. Warning the user about them
 * would just be noise.
 */
const SILENT_NOOP_CALLS: ReadonlySet<string> = new Set([
  'stringglobalvariable',
  'numericglobalvariable',
  'logoutput',
  'setuseactivesandboxproperty',
  'odbcclose',
  'odbcopen',
  'cubeprocessfeeders',
  'cubesetlogchanges',
  'asciidelete',
  'debugutility',
  // The captured source rows were decoded by TM1 with this charset already.
  'setinputcharacterset',
]);

/**
 * Process control-flow sentinels — thrown by the corresponding TI keywords
 * and caught by the runner at the appropriate level.
 *  - ItemSkip: stop the current Data-row, continue with next row.
 *  - ProcessBreak: stop the Data loop entirely, continue with Epilog.
 *  - ProcessQuit: stop the whole process immediately.
 */
export class ItemSkipSignal extends Error {
  constructor() {
    super('ITEMSKIP');
  }
}
export class ProcessBreakSignal extends Error {
  constructor() {
    super('PROCESSBREAK');
  }
}
export class ProcessQuitSignal extends Error {
  constructor() {
    super('PROCESSQUIT');
  }
}
/** Loop-local break (the bare `Break;` keyword inside `While...End`). */
export class BreakSignal extends Error {
  constructor() {
    super('BREAK');
  }
}

export type EvalContext = {
  scope: Scope;
  output: OutputCollector;
  warnings: SimWarning[];
  section: Section;
  fixtures?: Fixtures;
  /** Phase 2.5: loader for recursive ExecuteProcess descent. */
  subProcessLoader?: SubProcessLoader;
  /** Current recursion depth (root = 0). */
  subDepth?: number;
  /** Call stack of sub names — used for cycle detection. */
  subStack?: readonly string[];
};

function asString(v: Value): string {
  return typeof v === 'string' ? v : String(v);
}

function asNumber(v: Value): number {
  if (typeof v === 'number') return v;
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function emitCellWrite(
  ctx: EvalContext,
  rawName: string,
  argValues: Value[],
  stmt: Statement,
): void {
  if (argValues.length < 2) {
    ctx.warnings.push({
      section: ctx.section,
      statementIndex: stmt.line,
      message: `${rawName}: needs at least 2 args (value, cube)`,
    });
    return;
  }
  const op = (rawName.toLowerCase() === 'cellputs'
    ? 'CellPutS'
    : rawName.toLowerCase() === 'cellincrementn'
      ? 'CellIncrementN'
      : 'CellPutN') as CellOpName;
  const cube = asString(argValues[1]);
  const coord = argValues.slice(2).map(asString);
  const value: Value = op === 'CellPutS' ? asString(argValues[0]) : asNumber(argValues[0]);
  ctx.output.emit(op, cube, coord, value);
}

function asNum(v: number | string): number {
  if (typeof v === 'number') return v;
  if (v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const MAX_WHILE_ITERS = 1_000_000;

export function evalStatement(stmt: Statement, ctx: EvalContext): void {
  if (stmt.kind === 'noop') return;

  if (stmt.kind === 'assign') {
    // Special-case: `nRC = ExecuteProcess('sub', ...)` — evalExpr would throw
    // (no ExecuteProcess builtin) AND the sub would NOT run recursively
    // (recursion lives in the statement-level handler). Detect the pattern
    // here, run the sub via the loader, then assign ProcessExitNormal (=0).
    if (
      stmt.value.kind === 'call' &&
      (stmt.value.name.toLowerCase() === 'executeprocess' ||
        stmt.value.name.toLowerCase() === 'runprocess')
    ) {
      runExecuteProcessAsStatement(
        { kind: 'call', name: stmt.value.name, args: stmt.value.args, line: stmt.line },
        ctx,
      );
      ctx.scope.set(stmt.target, 0);
      return;
    }
    try {
      const v = evalExpr(stmt.value, ctx.scope, ctx.fixtures);
      ctx.scope.set(stmt.target, v);
    } catch (e) {
      ctx.warnings.push({
        section: ctx.section,
        statementIndex: stmt.line,
        message: e instanceof EvalError ? e.message : String(e),
      });
    }
    return;
  }

  if (stmt.kind === 'if') {
    for (const branch of stmt.branches) {
      let truthy = true;
      if (branch.cond !== undefined) {
        try {
          truthy = asNum(evalExpr(branch.cond, ctx.scope, ctx.fixtures)) !== 0;
        } catch (e) {
          ctx.warnings.push({
            section: ctx.section,
            statementIndex: stmt.line,
            message: e instanceof EvalError ? e.message : String(e),
          });
          truthy = false;
        }
      }
      if (truthy) {
        for (const inner of branch.body) evalStatement(inner, ctx);
        return;
      }
    }
    return;
  }

  if (stmt.kind === 'while') {
    let iter = 0;
    let broken = false;
    while (!broken) {
      let truthy = false;
      try {
        truthy = asNum(evalExpr(stmt.cond, ctx.scope, ctx.fixtures)) !== 0;
      } catch (e) {
        ctx.warnings.push({
          section: ctx.section,
          statementIndex: stmt.line,
          message: e instanceof EvalError ? e.message : String(e),
        });
        break;
      }
      if (!truthy) break;
      try {
        for (const inner of stmt.body) evalStatement(inner, ctx);
      } catch (e) {
        if (e instanceof BreakSignal) {
          broken = true;
          break;
        }
        throw e;
      }
      iter++;
      if (iter > MAX_WHILE_ITERS) {
        ctx.warnings.push({
          section: ctx.section,
          statementIndex: stmt.line,
          message: `WHILE loop exceeded ${MAX_WHILE_ITERS} iterations — aborted`,
        });
        break;
      }
    }
    return;
  }

  // Bare control-flow keywords: throw signals the runner catches.
  const upper = stmt.name.toUpperCase();
  if (upper === 'ITEMSKIP' || upper === 'ITEMREJECT') {
    throw new ItemSkipSignal();
  }
  if (upper === 'BREAK') {
    throw new BreakSignal();
  }
  if (upper === 'PROCESSBREAK') {
    throw new ProcessBreakSignal();
  }
  if (upper === 'PROCESSQUIT' || upper === 'PROCESSERROR' || upper === 'CHOREQUIT') {
    // ProcessError signals an unrecoverable failure — treated like ProcessQuit
    // for simulator purposes (stop the process; downstream sub-runs aborted).
    // ChoreQuit outside a chore ends the process the same way: measured on
    // 11.8 (2026-10-19), status QuitCalled, the next statement never ran.
    throw new ProcessQuitSignal();
  }

  // Phase 2.5: recursive descent for ExecuteProcess/RunProcess when a loader
  // is provided and the first arg is a literal string. Falls through to the
  // no-op warning when the loader has no module for that name, or when the
  // first arg is not statically resolvable.
  {
    const lower = stmt.name.toLowerCase();
    if ((lower === 'executeprocess' || lower === 'runprocess') && ctx.subProcessLoader) {
      const first = stmt.args[0];
      if (first && first.kind === 'strLit') {
        const subName = first.value;
        const stack = ctx.subStack ?? [];
        const depth = ctx.subDepth ?? 0;
        if (stack.includes(subName)) {
          ctx.warnings.push({
            section: ctx.section,
            statementIndex: stmt.line,
            message: `ExecuteProcess('${subName}'): cycle detected (stack: ${stack.join(' → ')}) — skipping recursion`,
          });
          return;
        }
        if (depth >= MAX_SUB_DEPTH) {
          ctx.warnings.push({
            section: ctx.section,
            statementIndex: stmt.line,
            message: `ExecuteProcess('${subName}'): max sub-process depth ${MAX_SUB_DEPTH} reached — skipping`,
          });
          return;
        }
        const module = ctx.subProcessLoader(subName);
        if (module) {
          let argValues: Value[] = [];
          try {
            argValues = stmt.args.slice(1).map((a) => evalExpr(a, ctx.scope, ctx.fixtures));
          } catch (e) {
            ctx.warnings.push({
              section: ctx.section,
              statementIndex: stmt.line,
              message: `ExecuteProcess('${subName}'): arg eval failed — ${e instanceof EvalError ? e.message : String(e)}`,
            });
            return;
          }
          runSubModule(module, argValues, ctx, subName, depth, stack);
          return;
        }
      }
    }
  }

  const nameLower = stmt.name.toLowerCase();
  if (SILENT_NOOP_CALLS.has(nameLower)) {
    return;
  }

  // Sub-process calls are not recursively simulated — emit warning + skip.
  // Same treatment for ExecuteCommand (shell call) and SaveDataAll-style ops
  // that would mutate the live server.
  if (NOOP_STATEMENT_CALLS.has(nameLower)) {
    ctx.warnings.push({
      section: ctx.section,
      statementIndex: stmt.line,
      message: `${stmt.name} not executed by simulator (no-op)`,
    });
    return;
  }

  if (CELL_WRITE_OPS.has(stmt.name.toLowerCase())) {
    try {
      const argValues = stmt.args.map((a) => evalExpr(a, ctx.scope, ctx.fixtures));
      emitCellWrite(ctx, stmt.name, argValues, stmt);
    } catch (e) {
      ctx.warnings.push({
        section: ctx.section,
        statementIndex: stmt.line,
        message: e instanceof EvalError ? e.message : String(e),
      });
    }
    return;
  }

  // Route side-effect / metadata builtins (subset / dim-create / attr / etc.)
  // through the registry. Return value is ignored at statement level.
  const builtin = findBuiltin(stmt.name);
  if (builtin) {
    try {
      const argValues = stmt.args.map((a) => evalExpr(a, ctx.scope, ctx.fixtures));
      builtin.invoke(argValues, ctx.fixtures);
      // Phase C2: also record a typed log row so the simulator's output
      // matches `expected/dim-deltas.jsonl` produced by captureWorkflow.
      const row = buildOpRow(stmt.name, argValues);
      if (row) ctx.output.emitOp(row);
    } catch (e) {
      ctx.warnings.push({
        section: ctx.section,
        statementIndex: stmt.line,
        message: e instanceof EvalError ? e.message : String(e),
      });
    }
    return;
  }

  ctx.warnings.push({
    section: ctx.section,
    statementIndex: stmt.line,
    message: `unsupported call '${stmt.name}' — skipped (Phase α subset)`,
  });
}

/**
 * Run an ExecuteProcess call as a statement-side-effect (used by `assign`
 * when RHS is ExecuteProcess). Forwards to the same recursive sub-loader
 * flow that the statement-level handler uses. Caller assigns 0 to the
 * target as a synthetic ProcessExitNormal return.
 */
function runExecuteProcessAsStatement(
  stmt: Extract<Statement, { kind: 'call' }>,
  ctx: EvalContext,
): void {
  evalStatement(stmt, ctx);
}

/**
 * Recursively execute a sub-process module. Sub has its own variable scope
 * but shares the parent's output collector, warnings, and fixtures.
 *
 * Sections run prolog → metadata → data → epilog. When `module.source` is
 * provided, the data section iterates one pass per source row (matching TM1
 * DataSource semantics). ITEMSKIP per row → continue to next row. Without
 * source, the data section runs once and ITEMSKIP aborts it (prevents
 * fall-through ghost writes when guard rejects undefined vars).
 */
function runSubModule(
  module: SubProcessModule,
  argValues: Value[],
  parentCtx: EvalContext,
  subName: string,
  depth: number,
  stack: readonly string[],
): void {
  const subScope = new Scope();
  // TI's ExecuteProcess uses (pName, pValue) pairs after the sub-name arg:
  //   ExecuteProcess('Sub', 'pA', 1, 'pB', 'x')
  // → argValues = ['pA', 1, 'pB', 'x']. Bind by NAME (positional binding
  // would assign pA='pA', pB=1 — every subsequent param shifts by one).
  // Fall back to positional only when no name labels are detected (legacy
  // call style or single-arg subs).
  const looksPaired =
    argValues.length >= 2 &&
    argValues.length % 2 === 0 &&
    typeof argValues[0] === 'string' &&
    module.parameterNames.includes(String(argValues[0]));
  if (looksPaired) {
    for (let i = 0; i + 1 < argValues.length; i += 2) {
      const pName = String(argValues[i]);
      subScope.set(pName, argValues[i + 1]);
    }
  } else {
    module.parameterNames.forEach((paramName, idx) => {
      if (idx < argValues.length) subScope.set(paramName, argValues[idx]);
    });
  }

  const baseSubCtx = (section: Section): EvalContext => ({
    scope: subScope,
    output: parentCtx.output,
    warnings: parentCtx.warnings,
    section,
    fixtures: parentCtx.fixtures,
    subProcessLoader: parentCtx.subProcessLoader,
    subDepth: depth + 1,
    subStack: [...stack, subName],
  });

  type Parsed = ReturnType<typeof parseStatements>;
  const parsedSections: Record<Section, Parsed | null> = {
    prolog: null,
    metadata: null,
    data: null,
    epilog: null,
  };
  for (const section of ['prolog', 'metadata', 'data', 'epilog'] as const) {
    const src = module.sections[section];
    if (!src || src.trim() === '') continue;
    const parsed = parseStatements(src);
    for (const e of parsed.errors) {
      parentCtx.warnings.push({
        section: parentCtx.section,
        statementIndex: e.line,
        message: `sub '${subName}' [${section}]: parse error — ${e.message}`,
      });
    }
    parsedSections[section] = parsed;
  }

  // Differs from the top-level runner on purpose: metadata runs ONCE (not per
  // row) and rows bind only the datasource variables (no NValue/SValue auto-vars).
  // NewDateFormatter handles are per process in TM1: the sub starts with an
  // empty list and the parent gets its own back afterwards.
  const fx = parentCtx.fixtures;
  const parentFormatters = fx?.dateFormatters;
  if (fx) fx.dateFormatters = undefined;
  try {
    runProcessSections({
      statements: (section) => parsedSections[section]?.statements,
      ctx: (section, scope) => ({ ...baseSubCtx(section), scope }),
      scope: subScope,
      rows: module.source?.rows,
      applyRow: (scope, row) => {
        for (const [k, v] of Object.entries(rowBindings(row, module.variableNames))) {
          scope.set(k, v);
        }
      },
      metadataPerRow: false,
    });
  } finally {
    if (fx) fx.dateFormatters = parentFormatters;
  }
}

export type SectionRunPlan = {
  statements: (section: Section) => readonly Statement[] | undefined;
  ctx: (section: Section, scope: Scope) => EvalContext;
  /** Process scope (parameters, globals). */
  scope: Scope;
  /** Source records; empty/undefined = data section runs once without a row. */
  rows: readonly SourceRow[] | undefined;
  /** Binds one source record's variables into `scope`. */
  applyRow: (scope: Scope, row: SourceRow) => void;
  /** true: metadata runs once per record (bound into the process scope); false: once. */
  metadataPerRow: boolean;
};

/**
 * Runs prolog → metadata → data → epilog with TI's control-flow signals:
 * ItemSkip inside a data row skips the row (no-op elsewhere), ProcessBreak
 * stops the data loop and still runs the epilog, ProcessQuit halts everything.
 * Shared by the top-level runner and ExecuteProcess sub-modules.
 */
export function runProcessSections(plan: SectionRunPlan): void {
  let processQuit = false;
  let processBreak = false;

  const runSection = (section: Section, sectionScope: Scope): void => {
    const statements = plan.statements(section);
    if (!statements) return;
    const sectionCtx = plan.ctx(section, sectionScope);
    for (const stmt of statements) {
      try {
        evalStatement(stmt, sectionCtx);
      } catch (e) {
        if (e instanceof ItemSkipSignal) {
          // Outside the data section, ItemSkip behaves like a no-op
          if (section === 'data') throw e;
          return;
        }
        if (e instanceof ProcessBreakSignal) {
          if (section === 'data') throw e;
          processBreak = true;
          return;
        }
        if (e instanceof ProcessQuitSignal) {
          processQuit = true;
          return;
        }
        throw e;
      }
    }
  };

  const rows = plan.rows && plan.rows.length > 0 ? plan.rows : undefined;

  runSection('prolog', plan.scope);

  if (!processQuit) {
    if (rows && plan.metadataPerRow) {
      for (const row of rows) {
        plan.applyRow(plan.scope, row);
        runSection('metadata', plan.scope);
        if (processQuit || processBreak) break;
      }
    } else {
      runSection('metadata', plan.scope);
    }
  }

  if (!processQuit && !processBreak) {
    if (rows) {
      for (const row of rows) {
        // Child scope: datasource vars stay isolated per row.
        const dataScope = plan.scope.child();
        plan.applyRow(dataScope, row);
        try {
          runSection('data', dataScope);
        } catch (e) {
          if (e instanceof ItemSkipSignal) continue;
          if (e instanceof ProcessBreakSignal) {
            processBreak = true;
            break;
          }
          if (e instanceof ProcessQuitSignal) {
            processQuit = true;
            break;
          }
          throw e;
        }
        if (processQuit) break;
      }
    } else {
      try {
        runSection('data', plan.scope);
      } catch (e) {
        if (e instanceof ItemSkipSignal) {
          // Outside the source loop: ITEMSKIP aborts the data section
          // (prevents fall-through to subsequent statements that
          // would emit ghost writes from undefined variables).
        } else if (e instanceof ProcessBreakSignal) {
          processBreak = true;
        } else if (e instanceof ProcessQuitSignal) {
          processQuit = true;
        } else {
          throw e;
        }
      }
    }
  }

  if (!processQuit) runSection('epilog', plan.scope);
}
