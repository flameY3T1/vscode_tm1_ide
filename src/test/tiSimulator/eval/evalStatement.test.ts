import { describe, it, expect } from 'vitest';
import { evalStatement } from '../../../tiSimulator/eval/evalStatement';
import { Scope } from '../../../tiSimulator/eval/scope';
import { OutputCollector } from '../../../tiSimulator/output/outputCollector';
import { parseStatements } from '../../../tiSimulator/ast/parseStatement';
import type { SimWarning } from '../../../tiSimulator/types';

function runSnippet(src: string, scope = new Scope()) {
  const stmts = parseStatements(src).statements;
  const output = new OutputCollector();
  const warnings: SimWarning[] = [];
  for (const s of stmts) {
    evalStatement(s, { scope, output, warnings, section: 'prolog' });
  }
  return { scope, output, warnings };
}

describe('evalStatement', () => {
  it('executes simple assignment', () => {
    const r = runSnippet(`x = 1 + 2;`);
    expect(r.scope.get('x')).toBe(3);
  });

  it('emits CellPutN to output collector', () => {
    const r = runSnippet(`CellPutN(100, 'Plan', 'Jan');`);
    const rows = r.output.getRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ op: 'CellPutN', cube: 'Plan', coord: ['Jan'], value: 100 });
  });

  it('emits CellPutS', () => {
    const r = runSnippet(`CellPutS('hello', 'Notes', 'Jan');`);
    const rows = r.output.getRows();
    expect(rows[0]).toEqual({ op: 'CellPutS', cube: 'Notes', coord: ['Jan'], value: 'hello' });
  });

  it('emits CellIncrementN', () => {
    const r = runSnippet(`CellIncrementN(5, 'Plan', 'Jan'); CellIncrementN(3, 'Plan', 'Jan');`);
    const agg = r.output.getAggregated();
    expect([...agg.values()][0].value).toBe(8);
  });

  it('substitutes variables in cell-write args', () => {
    const r = runSnippet(`v = 42; CellPutN(v, 'Plan', 'Jan');`);
    expect(r.output.getRows()[0].value).toBe(42);
  });

  it('arithmetic in cell-write args', () => {
    const r = runSnippet(`CellPutN(2 * 3, 'Plan', 'Jan');`);
    expect(r.output.getRows()[0].value).toBe(6);
  });

  it('warns on unsupported function call', () => {
    const r = runSnippet(`UnsupportedFunc(1, 2);`);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].message).toContain('unsupported');
  });

  it('ExecuteProcess emits no-op warning', () => {
    const r = runSnippet(`ExecuteProcess('OtherProc', 'pParam', 'X');`);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].message).toContain('no-op');
    expect(r.output.getRows()).toHaveLength(0);
  });

  it('SaveDataAll emits no-op warning', () => {
    const r = runSnippet(`SaveDataAll();`);
    expect(r.warnings[0].message).toContain('no-op');
  });

  it('warns on cell-write with too few args', () => {
    const r = runSnippet(`CellPutN();`);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0].message).toContain('at least 2');
  });

  it('handles row binding via vdim_*', () => {
    const root = new Scope();
    const data = root.child();
    data.set('vdim_1', 'Element_1');
    data.set('vdim_2', 'Umsatz');
    const stmts = parseStatements(`CellPutN(1, 'Plan', vdim_1, vdim_2);`).statements;
    const output = new OutputCollector();
    const warnings: SimWarning[] = [];
    for (const s of stmts) {
      evalStatement(s, { scope: data, output, warnings, section: 'data' });
    }
    expect(output.getRows()[0].coord).toEqual(['Element_1', 'Umsatz']);
  });

  it('skips noop (comments)', () => {
    const r = runSnippet(`# header\nx = 1;`);
    expect(r.scope.get('x')).toBe(1);
  });

  it('BREAK exits the current WHILE loop', () => {
    const r = runSnippet(`
      n = 0;
      While( n < 10 );
        n = n + 1;
        If( n = 3 );
          Break;
        EndIf;
      End;
    `);
    expect(r.scope.get('n')).toBe(3);
  });

  it('StringGlobalVariable / NumericGlobalVariable are noops', () => {
    const r = runSnippet(`
      StringGlobalVariable('sFoo');
      NumericGlobalVariable('nBar');
    `);
    expect(r.warnings.length).toBe(0);
  });

  it('TM1 division operator `\\` is real (float) division, 0 on divide-by-zero', () => {
    // TM1 '\' is real division (no integer type) and returns 0 for a zero
    // divisor instead of erroring (unlike '/').
    expect(runSnippet(`x = 7 \\ 2;`).scope.get('x')).toBe(3.5);
    expect(runSnippet(`x = 5 \\ 0;`).scope.get('x')).toBe(0);
  });

  it('hierarchy qualifier `:` concatenates with separator', () => {
    const r = runSnippet(`s = 'Hier' : 'Elem';`);
    expect(r.scope.get('s')).toBe('Hier:Elem');
  });
});
