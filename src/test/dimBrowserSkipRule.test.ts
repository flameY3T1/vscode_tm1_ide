import { describe, expect, it } from 'vitest';
import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import type { AnswerRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';

const C = (name: string, level: number) => ({ name, type: 'C' as const, level });

function zeile(
  name: string, type: 'N' | 'C' | 'S', level: number,
  ancestors: Array<{ name: string; type: 'N' | 'C' | 'S'; level: number }>,
  drilled = false,
): AnswerRow {
  return {
    name, caption: name, type, level,
    parent: ancestors.length ? ancestors[ancestors.length - 1].name : null,
    drilled, ancestors,
  };
}

describe('the skip rule', () => {
  /**
   * The case is measured, not assumed: EXCEPT(Members, {xxx}, ALL) leaves the
   * children of xxx in place even though xxx itself is filtered out. An element
   * of the answer carries the full chain from the tree, and the chain runs until
   * a link fails in a filter layer — but not because it is MISSING.
   * A LINK that the answer does not contain at all is SKIPPED, it does not
   * cause a break.
   */
  it('skips a filtered-out ancestor — children under filtered roots are still there', () => {
    const v = initialView('tree');
    // Filter: only type 'C'. sum (ancestor, not in the window) survives it,
    // n1 (ancestor, not in the window) does not.
    const filtered = pushIntent(v, { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    const rows = [
      zeile('tief', 'C', 0, [C('sum', 3), { name: 'n1', type: 'N', level: 2 }]),
    ];
    const out = rowsFromAnswer(rows, filtered);
    // sum stays, n1 is skipped (no break), tief stands under sum.
    expect(out[0].depth).toBe(1);
    expect(out[0].key).toBe('sum\x00tief');
  });

  it('breaks at a COLLAPSED ancestor — its children would not be there at all', () => {
    const v = initialView('tree');
    const rows = [
      zeile('sum', 'C', 3, [], false), // drilled=false collapsed
      zeile('kind', 'N', 0, [C('sum', 3)]),
    ];
    const out = rowsFromAnswer(rows, v);
    expect(out[0].depth).toBe(0);
    // `sum` is closed; a row below it cannot be its child.
    expect(out[1].depth).toBe(0);
  });

  it('drops to depth 0 as soon as the order is replaced', () => {
    const v = initialView('set');
    const rows = [zeile('a', 'N', 0, [C('sum', 1)])];
    expect(rowsFromAnswer(rows, v)[0].depth).toBe(0);
  });

  it('without a filter counts every chain step — the state from Plan 2', () => {
    const v = initialView('tree');
    const rows = [zeile('blatt', 'N', 0, [C('w', 3), C('m', 2)])];
    const out = rowsFromAnswer(rows, v);
    expect(out[0].depth).toBe(2);
    expect(out[0].key).toBe('w\x00m\x00blatt');
  });

  it('treats an element that occurs twice as two rows', () => {
    const v = initialView('tree');
    const rows = [
      zeile('p1', 'C', 1, [], true),
      zeile('a', 'N', 0, [C('p1', 1)]),
      zeile('p2', 'C', 1, [], true),
      zeile('a', 'N', 0, [C('p2', 1)]),
    ];
    const out = rowsFromAnswer(rows, v);
    expect(out.map((r) => r.key)).toEqual(['p1', 'p1\x00a', 'p2', 'p2\x00a']);
  });

  it('requires an ancestor to survive ALL filter layers', () => {
    const v = initialView('tree');
    // Filter 1: only type 'C'
    let filtered = pushIntent(v, { kind: 'filter', layer: { kind: 'type', types: ['C'] } });
    // Filter 2: only pattern 'a*'
    filtered = pushIntent(filtered, { kind: 'filter', layer: { kind: 'pattern', pattern: 'a*' } });
    const rows = [
      zeile('ab', 'C', 1, [], true), // type OK, pattern OK
      zeile('zb', 'C', 1, [], true), // type OK, pattern WRONG — skipped
      zeile('result', 'N', 0, [C('ab', 1), C('zb', 1)]),
    ];
    const out = rowsFromAnswer(rows, filtered);
    // ab stays (both layers), zb drops out (pattern), result sits under ab.

    expect(out[2].depth).toBe(1);
    expect(out[2].key).toBe('ab\x00result');
  });
});
