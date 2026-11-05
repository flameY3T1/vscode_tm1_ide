import { describe, it, expect } from 'vitest';
import { formulaWithValues, type Operand } from '../../webviewClient/cellTrace/formulaValues';

const fmt = (v: number | string | null) => String(v);

describe('formulaWithValues', () => {
  const cell = { cube: 'Sales', dims: ['Year', 'Account', 'Measure'], tuple: ['2025', 'GM%', 'Value'] };

  it('puts the operand values into a same-cube formula', () => {
    const ops: Operand[] = [
      { cube: 'Sales', tuple: ['2025', 'GM', 'Value'], value: 1234 },
      { cube: 'Sales', tuple: ['2025', 'Revenue', 'Value'], value: 5678 },
    ];
    expect(formulaWithValues("['GM%'] = N: ['Account':'GM'] \\ ['Revenue'];", cell, ops, fmt))
      .toBe('1234 \\ 5678');
  });

  it('matches by tuple, not by position — an IF evaluates only one branch', () => {
    // Real shape (11.8, 2026-09-25): components come in EVALUATION order.
    const c = { cube: 'Detail', dims: ['Version', 'Customer', 'Pos', 'Kind', 'Measure'], tuple: ['PLAN', 'C1', 'Total', 'A-A', 'Value'] };
    const ops: Operand[] = [
      { cube: 'Detail', tuple: ['PLAN', 'C1', 'Total', 'A-A', 'Qty'], value: 15000 },
      { cube: 'Prices', tuple: ['PLAN', 'AllCustomers', 'A-A', 'Value'], value: 58 },
    ];
    const stmt = "['Value'] = N: ['Qty'] * IF(!Kind @= 'A-A', DB('Prices', !Version, 'AllCustomers', !Kind, !Measure)/2, DB('Prices', !Version, 'AllCustomers', !Kind, !Measure));";
    expect(formulaWithValues(stmt, c, ops, fmt))
      .toBe("15000 * IF(!Kind @= 'A-A', 58/2, 58)");
  });

  it('leaves a reference as written when an argument is an expression it cannot evaluate', () => {
    const ops: Operand[] = [{ cube: 'Sales', tuple: ['2025', 'X', 'Value'], value: 7 }];
    const stmt = "['GM%'] = N: DB('Sales', !Year, 'VD' | !Year, 'Value') + ['Account':'GM'];";
    // The expression argument is a wildcard; it still resolves because only one
    // component fits. The area reference has no operand and stays as written.
    expect(formulaWithValues(stmt, cell, ops, fmt)).toBe("7 + ['Account':'GM']");
  });

  it('keeps a reference with an unresolved argument when the only operand belongs to a fully written one', () => {
    const target = { cube: 'Target', dims: ['Version'], tuple: ['Result'] };
    const ops: Operand[] = [{ cube: 'Source', tuple: ['A'], value: 42 }];
    const stmt = "['Result'] = N: IF(1 = 1, DB('Source', 'A'), DB('Source', 'B' | !Version));";
    expect(formulaWithValues(stmt, target, ops, fmt)).toBe("IF(1 = 1, 42, DB('Source', 'B' | !Version))");
  });

  it('does not guess when two operands with different values fit', () => {
    const ops: Operand[] = [
      { cube: 'Sales', tuple: ['2025', 'A', 'Value'], value: 1 },
      { cube: 'Sales', tuple: ['2025', 'B', 'Value'], value: 2 },
    ];
    expect(formulaWithValues("['GM%'] = N: DB('Sales', !Year, 'VD' | !Year, 'Value');", cell, ops, fmt))
      .toBeUndefined();
  });

  it('keeps quoted text untouched and compares names without case', () => {
    const ops: Operand[] = [{ cube: 'sales', tuple: ['2025', 'gm', 'value'], value: 3 }];
    expect(formulaWithValues("['GM%'] = S: 'x[y]' | ['gm'];", cell, ops, fmt)).toBe("'x[y]' | 3");
    expect(formulaWithValues("['GM%'] = C: IF(1=1, 'x[y]', '') + ['gm'];", cell, ops, fmt))
      .toBe("IF(1=1, 'x[y]', '') + 3");
  });

  it('returns undefined for a set in braces — that is an area, not a cell', () => {
    const ops: Operand[] = [{ cube: 'Sales', tuple: ['2025', 'GM', 'Value'], value: 3 }];
    expect(formulaWithValues("['GM%'] = N: ['Account':{'GM','X'}];", cell, ops, fmt)).toBeUndefined();
  });

  it('does not label two unresolved references with the one operand', () => {
    const c = { cube: 'Target', dims: ['Version'], tuple: ['Actual'] };
    const ops: Operand[] = [{ cube: 'Source', tuple: ['AActual'], value: 42 }];
    expect(formulaWithValues("['R'] = N: IF(1=1, DB('Source', 'A' | !Version), DB('Source', 'B' | !Version));", c, ops, fmt)).toBeUndefined();
  });
});
