/**
 * Tests for the 5 lifecycle/process-call lint rules (L3/L4/L5/L7/L8):
 *   cube-logging-not-restored, temp-object-not-destroyed,
 *   executeprocess-return-ignored, recursive-process-call,
 *   cellget-in-loop-constant.
 *
 * Same conventions as tiLinter.test.ts: hand-built ASTs, pure lintTiAst —
 * no vscode mock needed. Cross-section behavior is exercised via
 * LintOptions.futureAsts (the look-ahead channel the callers fill).
 */
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import type { LintOptions } from '../tiLogicVisualizer/tiLinter';
import type {
  TiAst,
  TiAssignment,
  TiFunctionCall,
  TiWhileBlock,
} from '../tiLogicVisualizer/types';

const call = (name: string, args: string[], line: number): TiFunctionCall =>
  ({ type: 'functionCall', name, args, line });

const assign = (variable: string, expression: string, line: number, cellGetInfo?: TiAssignment['cellGetInfo']): TiAssignment =>
  ({ type: 'assignment', variable, expression, isExternal: !!cellGetInfo, cellGetInfo, line });

const whileBlock = (condition: string, body: TiAst, line: number): TiWhileBlock =>
  ({ type: 'while', condition, body, line });

const byRule = (ast: TiAst, ruleId: string, options?: LintOptions, section?: 'prolog' | 'metadata' | 'data' | 'epilog') =>
  lintTiAst(ast, undefined, undefined, undefined, section, options).filter(d => d.ruleId === ruleId);

// ─── L3: cube-logging-not-restored ───────────────────────────────────────────

describe('L3 cube-logging-not-restored', () => {
  it('fires for CubeSetLogChanges(cube, 0) without restore', () => {
    const ast: TiAst = [call('CubeSetLogChanges', ["'Sales'", '0'], 3)];
    const diags = byRule(ast, 'cube-logging-not-restored');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(3);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageKey).toContain('without a matching restore');
    expect(diags[0].messageArgs).toEqual(["'Sales'"]);
  });

  it('does not fire when restored in the same section (case-insensitive literal match)', () => {
    const ast: TiAst = [
      call('CubeSetLogChanges', ["'Sales'", '0'], 1),
      call('CubeSetLogChanges', ["'SALES'", '1'], 5),
    ];
    expect(byRule(ast, 'cube-logging-not-restored')).toHaveLength(0);
  });

  it('does not fire for disable in prolog + restore in epilog (futureAsts)', () => {
    const prolog: TiAst = [call('CubeSetLogChanges', ["'Sales'", '0'], 2)];
    const epilog: TiAst = [call('CubeSetLogChanges', ["'Sales'", '1'], 1)];
    expect(byRule(prolog, 'cube-logging-not-restored', { futureAsts: [epilog] }, 'prolog')).toHaveLength(0);
  });

  it('does not fire when cube is matched via identical variable token', () => {
    const ast: TiAst = [
      call('CubeSetLogChanges', ['sCube', '0'], 1),
      call('CubeSetLogChanges', ['SCUBE', '1'], 2),
    ];
    expect(byRule(ast, 'cube-logging-not-restored')).toHaveLength(0);
  });

  it('fires when the restore targets a different cube token', () => {
    const ast: TiAst = [
      call('CubeSetLogChanges', ["'Sales'", '0'], 1),
      call('CubeSetLogChanges', ["'Costs'", '1'], 2),
    ];
    const diags = byRule(ast, 'cube-logging-not-restored');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(1);
  });

  it('stays silent when the flag is not a 0/1 literal constant', () => {
    const ast: TiAst = [call('CubeSetLogChanges', ["'Sales'", 'nFlag'], 1)];
    expect(byRule(ast, 'cube-logging-not-restored')).toHaveLength(0);
  });

  it('restore-only (flag 1) never fires', () => {
    const ast: TiAst = [call('CubeSetLogChanges', ["'Sales'", '1'], 1)];
    expect(byRule(ast, 'cube-logging-not-restored')).toHaveLength(0);
  });

  it('a restore BEFORE the disable does not count', () => {
    const ast: TiAst = [
      call('CubeSetLogChanges', ["'Sales'", '1'], 1),
      call('CubeSetLogChanges', ["'Sales'", '0'], 2),
    ];
    expect(byRule(ast, 'cube-logging-not-restored')).toHaveLength(1);
  });
});

// ─── L4: temp-object-not-destroyed ───────────────────────────────────────────

describe('L4 temp-object-not-destroyed', () => {
  it('fires for ViewCreate without ViewDestroy', () => {
    const ast: TiAst = [call('ViewCreate', ["'Sales'", "'tmpView'"], 4)];
    const diags = byRule(ast, 'temp-object-not-destroyed');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(4);
    expect(diags[0].severity).toBe('hint');
    expect(diags[0].messageKey).toContain('is created but never destroyed');
    expect(diags[0].messageArgs).toEqual(["'tmpView'"]);
  });

  it('does not fire when ViewDestroy follows in a later section (futureAsts)', () => {
    const prolog: TiAst = [call('ViewCreate', ["'Sales'", "'tmpView'"], 1)];
    const epilog: TiAst = [call('ViewDestroy', ["'Sales'", "'tmpView'"], 1)];
    expect(byRule(prolog, 'temp-object-not-destroyed', { futureAsts: [epilog] }, 'prolog')).toHaveLength(0);
  });

  it('does not fire when the temp flag is set (ViewCreate ..., 1)', () => {
    const ast: TiAst = [call('ViewCreate', ["'Sales'", "'tmpView'", '1'], 1)];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('does not fire for ViewCreateByMDX with temp flag as 4th arg', () => {
    const ast: TiAst = [call('ViewCreateByMDX', ["'Sales'", "'tmpView'", "'SELECT...'", '1'], 1)];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('fires for SubsetCreate without SubsetDestroy', () => {
    const ast: TiAst = [call('SubsetCreate', ["'Region'", "'tmpSub'"], 2)];
    const diags = byRule(ast, 'temp-object-not-destroyed');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(2);
  });

  it('does not fire for SubsetCreate with matching SubsetDestroy later in same section', () => {
    const ast: TiAst = [
      call('SubsetCreate', ["'Region'", "'tmpSub'"], 1),
      call('SubsetDestroy', ["'REGION'", "'TMPSUB'"], 9),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('does not fire for SubsetCreate with temp flag 1', () => {
    const ast: TiAst = [call('SubsetCreate', ["'Region'", "'tmpSub'", '1'], 1)];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('matches via identical variable tokens', () => {
    const ast: TiAst = [
      call('ViewCreate', ['sCube', 'sView'], 1),
      call('ViewDestroy', ['sCube', 'sView'], 2),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('a destroy of a DIFFERENT view does not pair', () => {
    const ast: TiAst = [
      call('ViewCreate', ["'Sales'", "'tmpView'"], 1),
      call('ViewDestroy', ["'Sales'", "'otherView'"], 2),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(1);
  });

  it('stays silent when the temp flag is a variable (not statically decidable)', () => {
    const ast: TiAst = [call('ViewCreate', ["'Sales'", "'tmpView'", 'nTemp'], 1)];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('resolves a destroy container variable to its assigned literal (same section)', () => {
    const ast: TiAst = [
      call('SubsetCreate', ["'DimX'", "'tmpSub'"], 1),
      assign('dim', "'DimX'", 8),
      call('SubsetDestroy', ['dim', "'tmpSub'"], 9),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('resolves a destroy container variable assigned in a later section (futureAsts)', () => {
    const prolog: TiAst = [call('SubsetCreate', ["'DimX'", "'tmpSub'"], 2)];
    const epilog: TiAst = [
      assign('dim', "'DimX'", 1),
      call('SubsetDestroy', ['dim', "'tmpSub'"], 2),
    ];
    expect(byRule(prolog, 'temp-object-not-destroyed', { futureAsts: [epilog] }, 'prolog')).toHaveLength(0);
  });

  it('resolves both container and subset-name variables to their literals', () => {
    const prolog: TiAst = [call('SubsetCreate', ["'DimX'", "'tmpSub'"], 2)];
    const epilog: TiAst = [
      assign('dim', "'DimX'", 1),
      assign('sub', "'tmpSub'", 2),
      call('SubsetDestroy', ['dim', 'sub'], 3),
    ];
    expect(byRule(prolog, 'temp-object-not-destroyed', { futureAsts: [epilog] }, 'prolog')).toHaveLength(0);
  });

  it('still fires when a destroy variable resolves to a DIFFERENT literal', () => {
    const ast: TiAst = [
      call('SubsetCreate', ["'DimX'", "'tmpSub'"], 1),
      assign('dim', "'DimY'", 8),
      call('SubsetDestroy', ['dim', "'tmpSub'"], 9),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(1);
  });

  it('pairs names that differ only in whitespace (TM1 ignores spaces; default on)', () => {
    const ast: TiAst = [
      call('SubsetCreate', ["'Region'", "'tmp Sub'"], 1),
      call('SubsetDestroy', ["'Region'", "'tmpSub'"], 9),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed')).toHaveLength(0);
  });

  it('treats whitespace as significant when nameWhitespaceInsensitive is false', () => {
    const ast: TiAst = [
      call('SubsetCreate', ["'Region'", "'tmp Sub'"], 1),
      call('SubsetDestroy', ["'Region'", "'tmpSub'"], 9),
    ];
    expect(byRule(ast, 'temp-object-not-destroyed', { nameWhitespaceInsensitive: false })).toHaveLength(1);
  });
});

// ─── L5: executeprocess-return-ignored ───────────────────────────────────────

describe('L5 executeprocess-return-ignored', () => {
  it('fires for a bare ExecuteProcess statement', () => {
    const ast: TiAst = [call('ExecuteProcess', ["'Sub.Process'"], 7)];
    const diags = byRule(ast, 'executeprocess-return-ignored');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(7);
    expect(diags[0].severity).toBe('hint');
    expect(diags[0].messageKey).toContain('return value of ExecuteProcess is ignored');
  });

  it('does not fire when the return value is assigned', () => {
    const ast: TiAst = [assign('nRet', "ExecuteProcess('Sub.Process')", 1)];
    expect(byRule(ast, 'executeprocess-return-ignored')).toHaveLength(0);
  });

  it('does not fire when used inside an IF condition', () => {
    const ast: TiAst = [{
      type: 'if',
      condition: "ExecuteProcess('Sub.Process') = ProcessExitByDone()",
      thenBody: [assign('nOk', '1', 2)],
      elseIfClauses: [],
      elseBody: [],
      line: 1,
    }];
    expect(byRule(ast, 'executeprocess-return-ignored')).toHaveLength(0);
  });

  it('does not fire for bare RunProcess (async, return is only an ID)', () => {
    const ast: TiAst = [call('RunProcess', ["'Sub.Process'"], 1)];
    expect(byRule(ast, 'executeprocess-return-ignored')).toHaveLength(0);
  });
});

// ─── L7: recursive-process-call ──────────────────────────────────────────────

describe('L7 recursive-process-call', () => {
  it('fires for ExecuteProcess with own name (case-insensitive)', () => {
    const ast: TiAst = [call('ExecuteProcess', ["'my.PROCESS'"], 5)];
    const diags = byRule(ast, 'recursive-process-call', { processName: 'My.Process' });
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(5);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].messageKey).toContain('Process calls itself');
  });

  it('fires for bare RunProcess with own name', () => {
    const ast: TiAst = [call('RunProcess', ["'My.Process'"], 1)];
    expect(byRule(ast, 'recursive-process-call', { processName: 'My.Process' })).toHaveLength(1);
  });

  it('fires when the recursive call return value is assigned', () => {
    const ast: TiAst = [assign('nRet', "ExecuteProcess('My.Process', 'pYear', sYear)", 3)];
    const diags = byRule(ast, 'recursive-process-call', { processName: 'my.process' });
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(3);
  });

  it('does not fire for a different process name', () => {
    const ast: TiAst = [call('ExecuteProcess', ["'Other.Process'"], 1)];
    expect(byRule(ast, 'recursive-process-call', { processName: 'My.Process' })).toHaveLength(0);
  });

  it('stays silent without processName in the options', () => {
    const ast: TiAst = [call('ExecuteProcess', ["'My.Process'"], 1)];
    expect(byRule(ast, 'recursive-process-call')).toHaveLength(0);
    expect(byRule(ast, 'recursive-process-call', {})).toHaveLength(0);
  });

  it('does not fire when the process name is a variable instead of a literal', () => {
    const ast: TiAst = [call('ExecuteProcess', ['sProcName'], 1)];
    expect(byRule(ast, 'recursive-process-call', { processName: 'My.Process' })).toHaveLength(0);
  });
});

// ─── L8: cellget-in-loop-constant ────────────────────────────────────────────

describe('L8 cellget-in-loop-constant', () => {
  const constCellGet = (line: number): TiAssignment =>
    assign('nVal', "CellGetN('Sales', 'Total', '2026')", line,
      { fn: 'CellGetN', params: ["'Sales'", "'Total'", "'2026'"] });

  it('fires for an all-literal CellGetN inside a WHILE block', () => {
    const ast: TiAst = [whileBlock('nI <= 10', [
      constCellGet(2),
      assign('nI', 'nI + 1', 3),
    ], 1)];
    const diags = byRule(ast, 'cellget-in-loop-constant');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(2);
    expect(diags[0].severity).toBe('hint');
    expect(diags[0].messageKey).toContain('does not change per iteration');
  });

  it('fires for an all-literal CellGetS in the data section (per record)', () => {
    const ast: TiAst = [
      assign('sVal', "CellGetS('Sales', 'Total', 'Comment')", 1,
        { fn: 'CellGetS', params: ["'Sales'", "'Total'", "'Comment'"] }),
    ];
    const diags = byRule(ast, 'cellget-in-loop-constant', undefined, 'data');
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(1);
  });

  it('fires in the metadata section as well', () => {
    expect(byRule([constCellGet(1)], 'cellget-in-loop-constant', undefined, 'metadata')).toHaveLength(1);
  });

  it('fires for a bare CellGetN call statement inside a WHILE block', () => {
    const ast: TiAst = [whileBlock('nI <= 10', [
      call('CellGetN', ["'Sales'", "'Total'", "'2026'"], 2),
      assign('nI', 'nI + 1', 3),
    ], 1)];
    expect(byRule(ast, 'cellget-in-loop-constant')).toHaveLength(1);
  });

  it('does not fire when any argument is a variable', () => {
    const ast: TiAst = [whileBlock('nI <= 10', [
      assign('nVal', "CellGetN('Sales', sElem, '2026')", 2,
        { fn: 'CellGetN', params: ["'Sales'", 'sElem', "'2026'"] }),
      assign('nI', 'nI + 1', 3),
    ], 1)];
    expect(byRule(ast, 'cellget-in-loop-constant')).toHaveLength(0);
  });

  it('does not fire at prolog top level outside any loop', () => {
    expect(byRule([constCellGet(1)], 'cellget-in-loop-constant', undefined, 'prolog')).toHaveLength(0);
  });

  it('emits at most one diagnostic per line', () => {
    const ast: TiAst = [whileBlock('nI <= 10', [
      call('CellGetN', ["'Sales'", "'Total'", "'2026'"], 2),
      call('CellGetN', ["'Costs'", "'Total'", "'2026'"], 2),
      assign('nI', 'nI + 1', 3),
    ], 1)];
    expect(byRule(ast, 'cellget-in-loop-constant')).toHaveLength(1);
  });
});
