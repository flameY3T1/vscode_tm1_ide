import { describe, it, expect } from 'vitest';
import { collectAncestors, computeIndentDepths } from '../webviewClient/cubeViewerMonaco/rowIndentPure';

describe('collectAncestors', () => {
  const parents = { P: 'ROOT', C1: 'P', C2: 'P', GC: 'C2' } as Record<string, string>;

  it('collects the whole chain upwards', () => {
    expect([...collectAncestors('GC', parents)].sort()).toEqual(['C2', 'P', 'ROOT']);
    expect([...collectAncestors('P', parents)]).toEqual(['ROOT']);
  });

  it('is empty for a member without parents', () => {
    expect(collectAncestors('ROOT', parents).size).toBe(0);
    expect(collectAncestors('X', parents).size).toBe(0);
  });

  it('follows ALL parent paths when the full map is there', () => {
    const all = { Kind: ['A', 'B'], A: ['Wurzel'], B: [] } as Record<string, string[]>;
    expect([...collectAncestors('Kind', {}, all)].sort()).toEqual(['A', 'B', 'Wurzel']);
  });

  it('is cycle-safe — and does not count the member as its own ancestor', () => {
    expect([...collectAncestors('A', { A: 'B', B: 'A' })]).toEqual(['B']);
  });
});

describe('computeIndentDepths', () => {
  it('gives equal-generation siblings the SAME depth even when TM1 Level differs', () => {
    // Real-data shape: parent P with 3 children whose subtrees differ in depth
    // (so their TM1 Level would be 0/1/2) but all are the same generation.
    const parents = [{ P: 'ROOT', leaf: 'P', midC: 'P', deepC: 'P', gc: 'deepC' } as Record<string, string>];
    const tuples = [['P'], ['leaf'], ['midC'], ['deepC']];
    const depths = computeIndentDepths(tuples, parents);
    // P at generation 1 → normalized depth 0; the three children at generation 2 → depth 1.
    expect(depths).toEqual([[0], [1], [1], [1]]);
  });

  it('normalizes so the shallowest shown member is depth 0', () => {
    const parents = [{ deepC: 'P', P: 'ROOT' } as Record<string, string>];
    const tuples = [['P'], ['deepC']]; // generations 1 and 2 → depths 0 and 1
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [1]]);
  });

  it('handles multiple row dims independently', () => {
    const parents = [
      { c: 'p', p: 'r' } as Record<string, string>,      // dim0
      { x: 'root' } as Record<string, string>,            // dim1 (flat)
    ];
    const tuples = [['p', 'x'], ['c', 'x']];
    // dim0: p gen1, c gen2 → depths 0,1 ; dim1: x gen1 both → normalized 0,0
    expect(computeIndentDepths(tuples, parents)).toEqual([[0, 0], [1, 0]]);
  });

  // Click test 2026-08-07, real data: level filter 0 on a cost dimension,
  // selection applied. Only leaves stand on the axis — VZP hangs directly under the
  // root, VZP End one level deeper. Not a single parent is visible, so
  // nothing may be indented either: the indentation would claim a relationship that the
  // grid does not show at all.
  it('indents NOTHING when no ancestor stands on the axis', () => {
    const parents = [{
      VZP: 'Kosten', Zwischensumme: 'Kosten', 'VZP End': 'Zwischensumme',
    } as Record<string, string>];
    const tuples = [['VZP'], ['VZP End']];
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [0]]);
  });

  it('indents as soon as the parent itself stands on the axis', () => {
    const parents = [{
      VZP: 'Kosten', Zwischensumme: 'Kosten', 'VZP End': 'Zwischensumme',
    } as Record<string, string>];
    const tuples = [['VZP'], ['Zwischensumme'], ['VZP End']];
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [0], [1]]);
  });

  // Click test 2026-08-07, second round: under "P Ergebnis" the children stood
  // flush. The cause was the FIRST-parent chain — if a member hangs under several
  // parents and the first is not on the axis, the search never found the visible
  // parent. With the all-parents map it must find it.
  it('finds the visible parent via a SECOND parent path too', () => {
    const first = [{ Kind: 'AndererBaum' } as Record<string, string>];
    const all = [{ Kind: ['AndererBaum', 'P Ergebnis'] } as Record<string, string[]>];
    const tuples = [['P Ergebnis'], ['Kind']];
    expect(computeIndentDepths(tuples, first, all)).toEqual([[0], [1]]);
  });

  // Second symptom of the same round: if you expand and the direct intermediate row
  // carries no value, it drops out of the axis. The grandchild therefore must not
  // stand flush — its visible ancestor is then simply the grandfather.
  it('indents against the nearest VISIBLE ancestor when the intermediate row is missing', () => {
    const parents = [{
      Zwischen: 'P Ergebnis', Enkel: 'Zwischen',
    } as Record<string, string>];
    const tuples = [['P Ergebnis'], ['Enkel']];   // "Zwischen" is suppressed
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [1]]);
  });

  it('still staggers two visible levels', () => {
    const parents = [{
      Zwischen: 'P Ergebnis', Enkel: 'Zwischen',
    } as Record<string, string>];
    const tuples = [['P Ergebnis'], ['Zwischen'], ['Enkel']];
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [1], [2]]);
  });

  // Click test 2026-08-07, third round: "D PL 010" dragged ABOVE "P Ergebnis"
  // in the Dimension Browser. Afterwards the ancestor stands BELOW the row — it can
  // no longer be its outline parent, so nothing may indent.
  // The browser showed it flush, the grid still indented.
  it('does NOT indent against an ancestor that stands below', () => {
    const parents = [{ 'D PL 010': 'P Ergebnis' } as Record<string, string>];
    const tuples = [['D PL 010'], ['P Ergebnis']];
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [0]]);
  });

  it('still indents the remaining children below the ancestor', () => {
    const parents = [{
      'D PL 010': 'P Ergebnis', 'D GuV 002': 'P Ergebnis',
    } as Record<string, string>];
    const tuples = [['D PL 010'], ['P Ergebnis'], ['D GuV 002']];
    expect(computeIndentDepths(tuples, parents)).toEqual([[0], [0], [1]]);
  });

  it('returns all-zero depths when no parents are known', () => {
    expect(computeIndentDepths([['a'], ['b']], [{}])).toEqual([[0], [0]]);
  });
});
