import { describe, it, expect } from 'vitest';
import { buildClipboard, planPaste, EMPTY_CLIPBOARD } from '../../dimensionEditor/pasteStructurePure';
import type { ElementType } from '../../dimensionEditor/model';

function els(...rows: Array<[string, ElementType]>): Map<string, { name: string; type: ElementType }> {
  return new Map(rows.map(([name, type]) => [name, { name, type }]));
}
function targets(...rows: Array<[string, ElementType]>): Map<string, { type: ElementType }> {
  return new Map(rows.map(([name, type]) => [name, { type }]));
}
const E = (parent: string, child: string, weight = 1) => ({ parent, child, weight });

describe('buildClipboard', () => {
  const source = els(['Top', 'C'], ['A', 'N'], ['B', 'N'], ['A1', 'N']);
  const edges = [E('Top', 'A'), E('Top', 'B'), E('A', 'A1')];

  it('takes only selected elements and edges between selected ones', () => {
    // The rule: A1 hangs under A but was not selected — it stays out,
    // and so does the edge A→A1.
    const clip = buildClipboard(['Top', 'A', 'B'], source, edges);
    expect(clip.elements).toEqual([
      { name: 'Top', type: 'C' }, { name: 'A', type: 'N' }, { name: 'B', type: 'N' },
    ]);
    expect(clip.edges).toEqual([E('Top', 'A'), E('Top', 'B')]);
  });

  it('with a single selection takes only the element, without edges', () => {
    const clip = buildClipboard(['Top'], source, edges);
    expect(clip.elements).toEqual([{ name: 'Top', type: 'C' }]);
    expect(clip.edges).toEqual([]);
  });

  it('keeps the type of the original — C and S too', () => {
    const src = els(['K', 'C'], ['T', 'S'], ['N1', 'N']);
    const clip = buildClipboard(['K', 'T', 'N1'], src, []);
    expect(clip.elements.map(e => e.type)).toEqual(['C', 'S', 'N']);
  });

  it('skips names without an element and duplicate mentions', () => {
    const clip = buildClipboard(['A', 'A', 'gibtsNicht'], source, edges);
    expect(clip.elements).toEqual([{ name: 'A', type: 'N' }]);
  });

  it('ignores deleted edges of the source', () => {
    const clip = buildClipboard(['Top', 'A'], source, [{ ...E('Top', 'A'), marked: 'deleted' }]);
    expect(clip.edges).toEqual([]);
  });
});

describe('planPaste', () => {
  const clip = {
    elements: [{ name: 'Top', type: 'C' as ElementType }, { name: 'A', type: 'N' as ElementType },
      { name: 'B', type: 'N' as ElementType }],
    edges: [E('Top', 'A'), E('Top', 'B')],
  };

  it('adds missing elements and rebuilds the copied structure', () => {
    const plan = planPaste(clip, null, targets(), []);
    expect(plan.addElements).toEqual([
      { name: 'Top', type: 'C' }, { name: 'A', type: 'N' }, { name: 'B', type: 'N' },
    ]);
    expect(plan.addEdges).toEqual([E('Top', 'A'), E('Top', 'B')]);
    expect(plan.skipped).toEqual([]);
  });

  it('hangs the roots of the selection under the clicked row', () => {
    const plan = planPaste(clip, 'Ziel', targets(['Ziel', 'C']), []);
    // Only `Top` is a root — A and B hang under their parent that was copied along.
    expect(plan.addEdges).toEqual([E('Top', 'A'), E('Top', 'B'), E('Ziel', 'Top')]);
  });

  it('does not create existing elements again, but links them', () => {
    // Measured live: an element of the dimension may be added to a further hierarchy
    // (201). Creating it twice would still be wrong.
    const plan = planPaste(clip, 'Ziel', targets(['Ziel', 'C'], ['A', 'N']), []);
    expect(plan.addElements.map(e => e.name)).toEqual(['Top', 'B']);
    expect(plan.addEdges).toContainEqual(E('Top', 'A'));
  });

  it('skips an element with a differing type instead of carrying it into the commit', () => {
    // TM1 answers this with 400 ElementLeafTypeConflict — the type belongs to the
    // dimension. Better to catch it here than when saving.
    const plan = planPaste(clip, null, targets(['A', 'S']), []);
    expect(plan.skipped).toEqual([{ name: 'A', reason: 'typeConflict' }]);
    expect(plan.addElements.map(e => e.name)).toEqual(['Top', 'B']);
    // Without A, the edge Top→A does not exist.
    expect(plan.addEdges).toEqual([E('Top', 'B')]);
  });

  it('reports an already existing edge as skipped', () => {
    const plan = planPaste(clip, null, targets(['Top', 'C'], ['A', 'N'], ['B', 'N']), [E('Top', 'A')]);
    expect(plan.addEdges).toEqual([E('Top', 'B')]);
    expect(plan.skipped).toEqual([{ name: 'A', reason: 'alreadyChild' }]);
  });

  it('rejects a cycle instead of building it', () => {
    // Target `A` lies under `Top`; hanging `Top` under `A` would close the cycle.
    const single = { elements: [{ name: 'Top', type: 'C' as ElementType }], edges: [] };
    const plan = planPaste(single, 'A', targets(['A', 'N'], ['Top', 'C']), [E('Top', 'A')]);
    expect(plan.addEdges).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'Top', reason: 'cycle' }]);
  });

  it('rejects the self-reference', () => {
    const single = { elements: [{ name: 'X', type: 'N' as ElementType }], edges: [] };
    const plan = planPaste(single, 'X', targets(['X', 'N']), []);
    expect(plan.addEdges).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'X', reason: 'cycle' }]);
  });

  it('stays idle with an empty clipboard', () => {
    const plan = planPaste(EMPTY_CLIPBOARD, 'Ziel', targets(['Ziel', 'C']), []);
    expect(plan).toEqual({ addElements: [], addEdges: [], skipped: [] });
  });
});
