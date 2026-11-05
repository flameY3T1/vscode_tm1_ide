import { describe, it, expect } from 'vitest';
import { buildSetExprQuery, parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';
import type { RawSetAnswer } from '../tm1Rest/dimensionSetQueryPure';

/**
 * The chain must be able to carry type and level, otherwise the client cannot
 * reproduce a type filter and indents wrongly. Measured (spec block D):
 * costs no time, only payload — hence orderable instead of across the board.
 */
describe('buildSetExprQuery', () => {
  it("orders today's projection for 'name'", () => {
    const q = buildSetExprQuery({ kind: 'name' });
    expect(q).toContain('$expand=Parent(');
    expect(q).not.toContain('Parent($select=Name;$expand=Element(');
  });

  it("orders type and level on EVERY chain step for 'name+element'", () => {
    const q = buildSetExprQuery({ kind: 'name+element' });
    // Not just once: the innermost step needs it just as much as the outermost.
    const stufen = q.split('Element($select=Type,Level)').length - 1;
    // 24 chain steps + the row itself.
    expect(stufen).toBeGreaterThanOrEqual(25);
  });

  it('stays a valid, closed bracketing in both forms', () => {
    // Since the attribute filter there are two axes — all four combinations.
    const formen = [
      { kind: 'name' }, { kind: 'name+element' },
      { kind: 'name', attr: 'SITENAME' }, { kind: 'name+element', attr: 'SITENAME' },
    ] as const;
    for (const chain of formen) {
      const q = buildSetExprQuery(chain);
      const auf = (q.match(/\(/g) || []).length;
      const zu = (q.match(/\)/g) || []).length;
      expect(auf, `Klammern in '${JSON.stringify(chain)}'`).toBe(zu);
    }
  });
});

describe('parseSetAnswer reads type and level of the ancestors', () => {
  /** Replica of a real answer: `x` under `xxx` under `sum`. */
  const antwort: RawSetAnswer = {
    Tuples: [{
      Members: [{
        Name: 'x',
        DisplayInfo: 0,
        Element: { Type: 'Numeric', Level: 0 },
        Parent: {
          Name: 'xxx',
          Element: { Type: 'Consolidated', Level: 2 },
          Parent: { Name: 'sum', Element: { Type: 'Consolidated', Level: 3 }, Parent: null },
        },
      }],
    }],
  };

  it('returns the chain root-first with type and level', () => {
    const rows = parseSetAnswer(antwort);
    expect(rows).toHaveLength(1);
    expect(rows[0].ancestors).toEqual([
      { name: 'sum', type: 'C', level: 3 },
      { name: 'xxx', type: 'C', level: 2 },
    ]);
  });

  it("falls back to 'N'/0 without `Element` on the ancestor — the 'name' order", () => {
    const ohne: RawSetAnswer = {
      Tuples: [{ Members: [{ Name: 'x', Parent: { Name: 'xxx', Parent: null } }] }],
    };
    expect(parseSetAnswer(ohne)[0].ancestors).toEqual([{ name: 'xxx', type: 'N', level: 0 }]);
  });

  it('keeps the parent name of the row unchanged', () => {
    expect(parseSetAnswer(antwort)[0].parent).toBe('xxx');
  });
});
