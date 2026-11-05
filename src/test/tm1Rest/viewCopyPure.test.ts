import { describe, it, expect } from 'vitest';

import {
  buildNativeViewCopyBody,
  buildMdxViewCopyBody,
  VIEW_COPY_ELEMENTS_MAX,
  type RawNativeView,
} from '../../tm1Rest/viewCopyPure';

const hier = (dim: string, h = dim) => ({ Name: h, Dimension: { Name: dim } });

describe('buildNativeViewCopyBody', () => {
  it('sets the derived type — without it the POST is 400', () => {
    // Live 11.8: a read result that was only stripped of its @odata.* fields, sent back, answers
    // "Object in payload is not a derived type of tm1.View".
    const plan = buildNativeViewCopyBody({}, 'Kopie');
    expect(plan.body['@odata.type']).toBe('#ibm.tm1.api.v1.NativeView');
    expect(plan.body.Name).toBe('Kopie');
  });

  it('keeps EVERY dimension of an axis', () => {
    // The reason why the Cube Viewer's read model is no good here: it
    // knows only one dimension per axis.
    const view: RawNativeView = {
      Rows: [
        { Subset: { Hierarchy: hier('DIM_001'), Expression: 'TM1SubsetAll([DIM_001])' } },
        { Subset: { Hierarchy: hier('DIM_002'), Expression: 'TM1SubsetAll([DIM_002])' } },
      ],
    };
    const rows = buildNativeViewCopyBody(view, 'K').body.Rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect((rows[0].Subset as Record<string, unknown>)['Hierarchy@odata.bind'])
      .toBe("Dimensions('DIM_001')/Hierarchies('DIM_001')");
  });

  it('writes a named subset as a reference and reports it', () => {
    const view: RawNativeView = {
      Rows: [{ Subset: { Name: 'Top10', Hierarchy: hier('Konto') } }],
    };
    const plan = buildNativeViewCopyBody(view, 'K');
    const rows = plan.body.Rows as Record<string, unknown>[];
    expect(rows[0]).toEqual({ 'Subset@odata.bind': "Dimensions('Konto')/Hierarchies('Konto')/Subsets('Top10')" });
    // The caller has to know what must exist on the other side, otherwise the POST is
    // a 400 without explanation.
    expect(plan.namedSubsets).toEqual([{ dim: 'Konto', hier: 'Konto', name: 'Top10' }]);
  });

  it('takes the element list when there is neither a name nor an expression', () => {
    const view: RawNativeView = {
      Columns: [{ Subset: { Hierarchy: hier('Jahr'), Elements: [{ Name: '2025' }, { Name: '2026' }] } }],
    };
    const cols = buildNativeViewCopyBody(view, 'K').body.Columns as Record<string, unknown>[];
    expect((cols[0].Subset as Record<string, unknown>)['Elements@odata.bind']).toEqual([
      "Dimensions('Jahr')/Hierarchies('Jahr')/Elements('2025')",
      "Dimensions('Jahr')/Hierarchies('Jahr')/Elements('2026')",
    ]);
  });

  it('gives up on an axis that is too large instead of silently truncating it', () => {
    // A halved axis would be a different view.
    const names = Array.from({ length: VIEW_COPY_ELEMENTS_MAX + 1 }, (_, i) => ({ Name: `E${i}` }));
    const plan = buildNativeViewCopyBody({ Rows: [{ Subset: { Hierarchy: hier('Gross'), Elements: names } }] }, 'K');
    expect(plan.oversized).toEqual(['Gross']);
    expect(plan.body.Rows).toEqual([]);
  });

  it('still copes with the limit itself', () => {
    const names = Array.from({ length: VIEW_COPY_ELEMENTS_MAX }, (_, i) => ({ Name: `E${i}` }));
    const plan = buildNativeViewCopyBody({ Rows: [{ Subset: { Hierarchy: hier('Gross'), Elements: names } }] }, 'K');
    expect(plan.oversized).toEqual([]);
    expect(plan.body.Rows).toHaveLength(1);
  });

  it('binds the selection of a title axis', () => {
    const view: RawNativeView = {
      Titles: [{
        Subset: { Hierarchy: hier('Version'), Elements: [{ Name: 'Ist' }, { Name: 'Plan' }] },
        Selected: { Name: 'Plan' },
      }],
    };
    const titles = buildNativeViewCopyBody(view, 'K').body.Titles as Record<string, unknown>[];
    expect(titles[0]['Selected@odata.bind']).toBe("Dimensions('Version')/Hierarchies('Version')/Elements('Plan')");
  });

  it('takes the first member for a title axis without a selection', () => {
    const view: RawNativeView = {
      Titles: [{ Subset: { Hierarchy: hier('Version'), Elements: [{ Name: 'Ist' }] } }],
    };
    const titles = buildNativeViewCopyBody(view, 'K').body.Titles as Record<string, unknown>[];
    expect(titles[0]['Selected@odata.bind']).toBe("Dimensions('Version')/Hierarchies('Version')/Elements('Ist')");
  });

  it('binds no selection on rows and columns', () => {
    const view: RawNativeView = {
      Rows: [{ Subset: { Hierarchy: hier('Version'), Elements: [{ Name: 'Ist' }] }, Selected: { Name: 'Ist' } }],
    };
    const rows = buildNativeViewCopyBody(view, 'K').body.Rows as Record<string, unknown>[];
    expect(rows[0]['Selected@odata.bind']).toBeUndefined();
  });

  it('counts an axis entry without a hierarchy as unreadable instead of inventing one', () => {
    const plan = buildNativeViewCopyBody({ Rows: [{ Subset: { Expression: 'irgendwas' } }] }, 'K');
    expect(plan.unreadable).toBe(1);
    expect(plan.body.Rows).toEqual([]);
  });

  it('takes hierarchy and dimension separately when they differ', () => {
    const view: RawNativeView = {
      Rows: [{ Subset: { Hierarchy: { Name: 'Alternativ', Dimension: { Name: 'Konto' } }, Expression: 'x' } }],
    };
    const rows = buildNativeViewCopyBody(view, 'K').body.Rows as Record<string, unknown>[];
    expect((rows[0].Subset as Record<string, unknown>)['Hierarchy@odata.bind'])
      .toBe("Dimensions('Konto')/Hierarchies('Alternativ')");
  });

  it('verdoppelt einfache Anfuehrungszeichen im Schluessel', () => {
    const view: RawNativeView = { Rows: [{ Subset: { Name: "O'Brien", Hierarchy: hier('Kunde') } }] };
    const rows = buildNativeViewCopyBody(view, 'K').body.Rows as Record<string, unknown>[];
    expect(rows[0]['Subset@odata.bind']).toContain("Subsets('O''Brien')");
  });

  it('takes over the suppression switches', () => {
    const plan = buildNativeViewCopyBody({ SuppressEmptyRows: true, SuppressEmptyColumns: false }, 'K');
    expect(plan.body.SuppressEmptyRows).toBe(true);
    expect(plan.body.SuppressEmptyColumns).toBe(false);
  });
});

describe('buildMdxViewCopyBody', () => {
  it('carries type, name and the expression', () => {
    expect(buildMdxViewCopyBody('SELECT ... ON 0 FROM [c]', 'K')).toEqual({
      '@odata.type': '#ibm.tm1.api.v1.MDXView',
      Name: 'K',
      MDX: 'SELECT ... ON 0 FROM [c]',
    });
  });
});
