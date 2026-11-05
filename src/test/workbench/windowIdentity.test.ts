// When editing a workbench, it has to be decided whether a
// SAVED entry and an OPEN window are the same. If the
// decision is too coarse, two windows merge into one — exactly the
// bug that occurred in the click test "test2view" during restore, just in
// a different place.
//
// The identity therefore belongs in the kind table: it is the one place
// that knows something per window kind.
import { describe, it, expect } from 'vitest';
import { identityOf } from '../../commands/workbench/windowKinds';

describe('identityOf', () => {
  it('distinguishes two kinds on the same target', () => {
    expect(identityOf({ kind: 'tm1CubeViewer', target: 'X' }))
      .not.toBe(identityOf({ kind: 'tm1RuleEditor', target: 'X' }));
  });

  it('distinguishes two targets of the same kind', () => {
    expect(identityOf({ kind: 'tm1ProcessEditor', target: 'A' }))
      .not.toBe(identityOf({ kind: 'tm1ProcessEditor', target: 'B' }));
  });

  it('considers the same process editor the same', () => {
    expect(identityOf({ kind: 'tm1ProcessEditor', target: 'A', state: { irgendwas: 1 } }))
      .toBe(identityOf({ kind: 'tm1ProcessEditor', target: 'A' }));
  });

  // ── The Cube Viewer: the view name belongs to the identity ────────────────
  // `CubeViewerManager.open` builds the panel key from it. Two viewers on
  // the same cube are two windows, not a duplicate entry.

  it('distinguishes the cube panel and the view panel of the same cube', () => {
    expect(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: {} }))
      .not.toBe(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'APS' } }));
  });

  it('distinguishes two views of the same cube', () => {
    expect(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A' } }))
      .not.toBe(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'B' } }));
  });

  it('distinguishes the private from the public view of the same name', () => {
    expect(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A' } }))
      .not.toBe(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A', isPrivate: true } }));
  });

  it('leaves the expression out — it is content, not identity', () => {
    // Otherwise the same window would be a different one after every change and
    // would get a second entry when editing.
    expect(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A', mdx: 'SELECT 1' } }))
      .toBe(identityOf({ kind: 'tm1CubeViewer', target: 'C', state: { viewName: 'A', mdx: 'SELECT 2' } }));
  });

  it('copes with a window without target and without state', () => {
    expect(identityOf({ kind: 'tm1MdxRunner' })).toBe(identityOf({ kind: 'tm1MdxRunner' }));
  });
});
