// What comes back from a webview goes unseen into `globalState`. Two
// sizes can blow it up, both without the user intending it:
//
//  • A member list in the baggage of the response. For `Stations_ALL` that is
//    295,000 names.
//  • An MDX from a deeply expanded tree.
//
// A source scan does not catch that: the object is passed through, not
// built. Hence these tests at the place where it enters the extension — and
// the size is MEASURED, not read off the absence of a field name.
import { describe, it, expect } from 'vitest';
import {
  MDX_BYTE_CAP, sanitizeCubeViewerState, sanitizeDimBrowserState,
} from '../../commands/workbench/captureStatePure';

describe('sanitizeCubeViewerState', () => {
  const grob = { viewName: 'GuV', isPrivate: false };

  it('takes the coarse state when the webview did not answer', () => {
    const s = sanitizeCubeViewerState(undefined, grob);
    expect(s.viewName).toBe('GuV');
    expect(s.stateRead).toBe(false);
    expect(s.mdx).toBeUndefined();
  });

  it('keeps the view name NEXT TO the MDX', () => {
    // This is the difference between "picture" and "picture + operability": without
    // the name, the window would come back as an anonymous query.
    const s = sanitizeCubeViewerState({ mdx: 'SELECT 1', ui: { decimals: 2 } }, grob);
    expect(s.viewName).toBe('GuV');
    expect(s.mdx).toBe('SELECT 1');
    expect(s.stateRead).toBe(true);
  });

  it('takes over the control shell', () => {
    const ui = {
      titleAssignments: { Zeit: '2026' }, dimAliases: { Kunde: 'Langname' },
      suppressRows: true, suppressCols: false, decimals: 3, decComma: true,
    };
    expect(sanitizeCubeViewerState({ mdx: 'X', ui }, grob).ui).toEqual(ui);
  });

  it('throws away an MDX that is too large, but keeps the shell', () => {
    const huge = 'X'.repeat(MDX_BYTE_CAP + 1);
    const s = sanitizeCubeViewerState({ mdx: huge, ui: { decimals: 2 } }, grob);
    expect(s.mdx).toBeUndefined();
    expect(s.mdxDropped).toBe(true);
    expect(s.ui).toEqual({ decimals: 2 });
    expect(s.viewName).toBe('GuV');
  });

  it('measures the cap in bytes, not in characters', () => {
    // An umlaut is two bytes in UTF-8. Whoever counts characters lets
    // double the amount through.
    const s = sanitizeCubeViewerState({ mdx: 'ä'.repeat(MDX_BYTE_CAP / 2 + 1) }, grob);
    expect(s.mdxDropped).toBe(true);
  });

  it('lets an MDX exactly at the limit through', () => {
    const s = sanitizeCubeViewerState({ mdx: 'X'.repeat(MDX_BYTE_CAP) }, grob);
    expect(s.mdx).toBeDefined();
    expect(s.mdxDropped).toBeUndefined();
  });

  it('copes with garbage from the webview', () => {
    expect(sanitizeCubeViewerState('nein', grob).stateRead).toBe(false);
    expect(sanitizeCubeViewerState(null, grob).stateRead).toBe(false);
    expect(sanitizeCubeViewerState({ mdx: 42 }, grob).mdx).toBeUndefined();
  });
});

describe('sanitizeDimBrowserState', () => {
  it('keeps the expression — it is the statement', () => {
    // Only the expression carries the expand/collapse state. A name list looks the same
    // whether a consolidation is collapsed or expanded.
    const s = sanitizeDimBrowserState({ mdx: 'DRILLUPMEMBER({[Kunde].[Alle]}, {[Kunde].[Nord]})' });
    expect(s.mdx).toContain('DRILLUPMEMBER');
    expect(s.stateRead).toBe(true);
  });

  it('keeps the record small, no matter what the webview sends along', () => {
    // The case once feared: 300,000 members in the baggage. Do not check the
    // absence of ONE field, but the SIZE — an object passed through
    // would carry the list under a different name.
    const riesig = {
      hierarchy: 'H', mdx: '{[D].[E]}',
      baseMembers: Array.from({ length: 300_000 }, (_, i) => `E${i}`),
      compose: { baseMembers: Array.from({ length: 300_000 }, (_, i) => `E${i}`) },
    };
    expect(JSON.stringify(sanitizeDimBrowserState(riesig)).length).toBeLessThan(4096);
  });

  it('throws away an expression that is too large, but keeps hierarchy and alias', () => {
    const s = sanitizeDimBrowserState({
      hierarchy: 'Regionen', alias: 'Langname', mdx: 'X'.repeat(MDX_BYTE_CAP + 1),
    });
    expect(s.mdx).toBeUndefined();
    expect(s.mdxDropped).toBe(true);
    expect(s.hierarchy).toBe('Regionen');
    expect(s.alias).toBe('Langname');
  });

  it('remembers hierarchy, alias and Subset', () => {
    const s = sanitizeDimBrowserState({
      hierarchy: 'Regionen', alias: 'Langname',
      subset: { name: 'Top', isPrivate: true },
    });
    expect(s.hierarchy).toBe('Regionen');
    expect(s.alias).toBe('Langname');
    expect(s.subset).toEqual({ name: 'Top', isPrivate: true });
    expect(s.stateRead).toBe(true);
  });

  it('reports unread when nothing came', () => {
    expect(sanitizeDimBrowserState(undefined).stateRead).toBe(false);
    expect(sanitizeDimBrowserState('nein').stateRead).toBe(false);
  });

  it('copes with a view without an expression', () => {
    const s = sanitizeDimBrowserState({ hierarchy: 'H' });
    expect(s.stateRead).toBe(true);
    expect(s.mdx).toBeUndefined();
  });
});
