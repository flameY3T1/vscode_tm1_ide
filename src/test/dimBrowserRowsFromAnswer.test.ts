import { describe, it, expect } from 'vitest';
import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import type { AnswerRow, AncestorRef } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { initialView } from '../webviewClient/dimensionBrowser/intents';

/**
 * Only the names count for deriving depth/key — type/level per ancestor are
 * inconsequential filler values here (real values only with `chain:
 * 'name+element'`, see `dimBrowserAncestorMeta.test.ts`).
 */
const anc = (names: readonly string[]): AncestorRef[] => names.map((name) => ({ name, type: 'N' as const, level: 0 }));

const z = (name: string, parent: string | null, drilled: boolean, type: 'N' | 'C' = 'N'): AnswerRow =>
  ({ name, caption: name, type, level: type === 'C' ? 1 : 0, parent, drilled, ancestors: parent ? anc([parent]) : [] });

/**
 * `{[aa].[aa].Members}` — live 11.8, 2026-08-21
 * (membersIsExpandedProbe.js). `.Members` is the fully
 * expanded tree.
 */
const MEMBERS: AnswerRow[] = [
  z('sum', null, true, 'C'), z('a', 'sum', false),
  z('d', null, true, 'C'), z('c', 'd', false), z('a', 'd', false), z('x', 'd', false), z('b', 'd', false),
  z('xxx', null, true, 'C'), z('x', 'xxx', false), z('xx', 'xxx', false),
];

describe('rowsFromAnswer', () => {
  it('indents children under their parent', () => {
    expect(rowsFromAnswer(MEMBERS, initialView('tree')).map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual([
      'sum', '  a',
      'd', '  c', '  a', '  x', '  b',
      'xxx', '  x', '  xx',
    ]);
  });

  it('clears the stack when a root follows', () => {
    const rows = rowsFromAnswer(MEMBERS, initialView('tree'));
    expect(rows.find((r) => r.name === 'xxx')!.depth).toBe(0);
  });

  it('gives every row a key made of path and name, separated by NUL', () => {
    // NUL instead of a space, because element names can themselves contain
    // spaces (e.g. `D GUV 006 MaterialCost`) — otherwise parent `sum a` +
    // child `b` collide with parent `sum` + child `a b`.
    const rows = rowsFromAnswer(MEMBERS, initialView('tree'));
    expect(rows.filter((r) => r.name === 'a').map((r) => r.key)).toEqual(['sum\x00a', 'd\x00a']);
  });

  it('does NOT treat a collapsed node as open', () => {
    // `DRILLUPMEMBER(.Members, {d})` — measured live: `d` no longer carries
    // DRILLED_DOWN, and its children are missing.
    const zu: AnswerRow[] = [
      z('sum', null, true, 'C'), z('a', 'sum', false),
      z('d', null, false, 'C'),
      z('xxx', null, true, 'C'), z('x', 'xxx', false), z('xx', 'xxx', false),
    ];
    expect(rowsFromAnswer(zu, initialView('tree')).map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual([
      'sum', '  a', 'd', 'xxx', '  x', '  xx',
    ]);
  });

  it('treats a row without a matching parent as a root', () => {
    // `TM1SUBSETALL` returns `a` with `parent: sum`, but `sum` comes after it —
    // the row does NOT belong in a block there (measured live). This is
    // exactly the `hierarchisch: false` case from the table: a set draws
    // flat, no matter what the chain says.
    const menge: AnswerRow[] = [z('a', 'sum', false), z('b', 'd', false), z('sum', null, false, 'C')];
    expect(rowsFromAnswer(menge, initialView('set')).map((r) => r.depth)).toEqual([0, 0, 0]);
  });
});

describe('depth from the ancestor chain', () => {
  const k = (name: string, ancestors: string[], drilled = false): AnswerRow => ({
    name, caption: name, type: drilled ? 'C' : 'N', level: drilled ? 1 : 0,
    parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
    ancestors: anc(ancestors), drilled,
  });

  it('indents a window in the MIDDLE of the dimension correctly', () => {
    // `SUBSET(.Members, 500, …)` — the ancestors are above the window.
    // Values from setExprDepthSourceProbe.js.
    const fenster = [
      k('S00101', ['SITE2022_SuAlloc_Group_C', 'SITE2022_extern_C', 'SITE2022_S00101_C']),
      k('SITE2022_S00103_C', ['SITE2022_SuAlloc_Group_C', 'SITE2022_extern_C'], true),
      k('S00103', ['SITE2022_SuAlloc_Group_C', 'SITE2022_extern_C', 'SITE2022_S00103_C']),
    ];
    expect(rowsFromAnswer(fenster, initialView('tree')).map((r) => r.depth)).toEqual([3, 2, 3]);
  });

  it('gives the row a key made from the whole chain', () => {
    const fenster = [k('a', ['sum'])];
    expect(rowsFromAnswer(fenster, initialView('tree'))[0].key).toBe('sum\x00a');
  });

  it('draws flat over a SET, even though the rows know their parents', () => {
    // `TM1SUBSETALL` returns `a` with parent `sum`, but BEFORE `sum` — there
    // it belongs in no block (measured live on 11.8).
    const menge = [k('a', ['sum']), k('b', ['d']), k('sum', [], true)];
    expect(rowsFromAnswer(menge, initialView('set')).map((r) => r.depth)).toEqual([0, 0, 0]);
  });

  it('also draws flat over a frozen list', () => {
    const liste = [k('a', ['sum']), k('c', ['d'])];
    expect(rowsFromAnswer(liste, initialView('set')).map((r) => r.depth)).toEqual([0, 0]);
  });

  it('takes an ancestor only as long as it is also OPEN in the window', () => {
    // `d` is in the window and is CLOSED. A row that carries `d` in its chain
    // cannot then be its child — it belongs to another occurrence further up.
    const gemischt = [k('d', [], false), k('c', ['d'])];
    const rows = rowsFromAnswer(gemischt, initialView('tree'));
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
    // The chain is shortened, so the key does NOT carry `d` —
    // `c` is on the same level as `d`, not beneath it.
    expect(rows[1].key).toBe('c');
  });

  it('keeps the chain when an ancestor is open in the window', () => {
    const gemischt = [k('d', [], true), k('c', ['d'])];
    expect(rowsFromAnswer(gemischt, initialView('tree')).map((r) => r.depth)).toEqual([0, 1]);
  });

  it('keeps two occurrences of the same element apart', () => {
    // The same `X` is in the window twice: collapsed under `P1`, open under
    // `P2`. A name-based marker would also consider the open one closed and
    // would give `Y` the wrong depth AND the wrong key.
    const fenster = [
      k('P1', [], true), k('X', ['P1'], false),
      k('P2', [], true), k('X', ['P2'], true), k('Y', ['P2', 'X']),
    ];
    const rows = rowsFromAnswer(fenster, initialView('tree'));
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0, 1, 2]);
    expect(rows[4].key).toBe('P2\x00X\x00Y');
  });

  it('derives the depth from the chain length, even when the ancestor only comes LATER in the answer', () => {
    // Not a realistic server picture (a DFS answer never delivers ancestors
    // AFTER their child — see the invariant at the `collapsedInWindow` marker in
    // `rowsFromAnswer.ts`), but an edge-case probe of the function itself:
    // it pins down the new semantics (review finding I4a). The depth comes
    // ONLY from `r.ancestors`, not from an assumption about order — the function
    // never looks "backwards" to see whether an ancestor has already been drawn.
    const fenster = [k('a', ['sum']), k('sum', [], true)];
    expect(rowsFromAnswer(fenster, initialView('tree')).map((r) => r.depth)).toEqual([1, 0]);
  });

  it('also breaks the chain in the MIDDLE, not only at the first link', () => {
    // Until now all break tests broke at index 0 (the direct parent was
    // closed) — the `tiefe > 0` branch of the `break` remained untested (review
    // finding I4b). Here `A` is open, `B` (child of `A`) closed, `C` carries the
    // chain `A, B` as ancestors.
    const kette = [k('A', [], true), k('B', ['A'], false), k('C', ['A', 'B'])];
    const rows = rowsFromAnswer(kette, initialView('tree'));
    const c = rows.find((r) => r.name === 'C')!;
    expect(c.depth).toBe(1);
    // The key carries only the open part of the chain (`A`), not `B` as well
    // — that can collide with a REAL child of `A` named `C` (whose key would
    // also be `A\x00C`). Accepted deliberately until Plan 3 attaches the
    // collapse state per row to the key.
    expect(c.key).toBe('A\x00C');
  });

  it('does not indent a pure root list (formerly the "roots" base)', () => {
    // Since `hierarchisch: boolean` (review finding I1) the row model no longer
    // knows its own `roots` base — the caller sets `hierarchisch: true` for
    // `tree` AND `roots` alike (M5). This case stays flat because the chains
    // here are simply empty, not because `roots` would need a branch of its
    // own.

    const wurzeln = [k('sum', [], true), k('d', [], true), k('xxx', [], true)];
    expect(rowsFromAnswer(wurzeln, initialView('tree')).map((r) => r.depth)).toEqual([0, 0, 0]);
  });
});
