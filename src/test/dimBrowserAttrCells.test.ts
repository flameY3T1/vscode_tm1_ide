import { describe, it, expect } from 'vitest';
import { viewRowsHtml, spacerHtml, attrHeadHtml, colgroupHtml, tableMinWidth, NAME_MIN_PX }
  from '../webviewClient/dimensionBrowser/viewRender';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';

const zeile = (attrs?: Record<string, string>): DisplayRow => ({
  name: 'e1', caption: 'E1', type: 'N', level: 0, parent: null,
  drilled: false, ancestors: [], depth: 0, key: 'e1', ...(attrs ? { attrs } : {}),
});
const breite = () => 160;

describe('attribute cells in the row', () => {
  it('without columns it stays with ONE cell — as before', () => {
    const html = viewRowsHtml([zeile()], 0, () => false, -1, []);
    expect(html.match(/<td/g)!.length).toBe(1);
  });

  it('one cell per column, in column order', () => {
    const html = viewRowsHtml([zeile({ B: 'zwei', A: 'eins' })], 0, () => false, -1, ['A', 'B']);
    expect(html.match(/<td/g)!.length).toBe(3);
    expect(html.indexOf('eins')).toBeLessThan(html.indexOf('zwei'));
  });

  it('a missing value is an EMPTY cell, not a hole', () => {
    // TM1 leaves out empty attribute values (measured live). If the cell drops
    // away entirely, the whole table shifts from this row on.
    const html = viewRowsHtml([zeile({ A: 'eins' })], 0, () => false, -1, ['A', 'B']);
    expect(html.match(/<td/g)!.length).toBe(3);
  });

  it('rows without an attrs field still get their empty cells', () => {
    const html = viewRowsHtml([zeile()], 0, () => false, -1, ['A']);
    expect(html.match(/<td/g)!.length).toBe(2);
  });

  it('escapes the value', () => {
    const html = viewRowsHtml([zeile({ A: `<b>&'x` })], 0, () => false, -1, ['A']);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toMatch(/>[^<]*'x/);
  });
});

describe('spacer and header grow along', () => {
  it('the spacer spans the name column PLUS the attribute columns', () => {
    // Otherwise the table layout tips over as soon as columns are there.
    expect(spacerHtml(100, 0)).toContain('colspan="1"');
    expect(spacerHtml(100, 3)).toContain('colspan="4"');
  });

  it('without columns the header stays empty — as before', () => {
    expect(attrHeadHtml([], breite)).toBe('');
  });

  it('with columns the header carries one name and one drag area each', () => {
    const html = attrHeadHtml(['A', 'B'], breite);
    expect(html.match(/<th/g)!.length).toBe(3);   // Name + A + B
    expect(html.match(/vw-col-grip/g)!.length).toBe(2);
    expect(html).toContain('data-col="A"');
  });

  it('without columns the table gets NO minimum width — as before', () => {
    // Fix round 2, finding 4: whoever never switches on an attribute column should
    // see exactly the layout from before.
    expect(tableMinWidth([], breite)).toBe('');
  });

  it('with columns the minimum width keeps the name column open', () => {
    // Name column + sum of the attribute widths. If that reaches beyond the
    // container, `#table-container` scrolls horizontally instead of
    // squeezing the name column together.
    expect(tableMinWidth(['A', 'B'], breite)).toBe((NAME_MIN_PX + 320) + 'px');
  });

  it('the colgroup leaves the name column WITHOUT a width', () => {
    // `table-layout: fixed` gives a column without a width the rest — exactly
    // what the name column is supposed to get.
    const html = colgroupHtml(['A'], breite);
    expect(html).toBe('<colgroup><col><col style="width:160px"></colgroup>');
  });
});
