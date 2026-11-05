import { describe, it, expect } from 'vitest';
import { viewRowsHtml } from '../webviewClient/dimensionBrowser/viewRender';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';

function zeile(over: Partial<DisplayRow> = {}): DisplayRow {
  return {
    name: 'a', caption: 'a', type: 'N', level: 0, parent: null, drilled: false,
    ancestors: [], depth: 0, key: 'a', ...over,
  };
}

describe('ARIA per row', () => {
  it('every row is a row with level and position', () => {
    const html = viewRowsHtml([zeile(), zeile()], 0, () => false, 803808);
    expect(html).toContain('role="row"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-posinset="2"');
    // Without setsize the screen reader reads "1 of 5000" instead of "1 of 803808".
    expect(html).toContain('aria-setsize="803808"');
  });

  it('aria-level counts from 1, depth from 0', () => {
    const html = viewRowsHtml([zeile({ depth: 2 })], 0, () => false, 10);
    expect(html).toContain('aria-level="3"');
  });

  it('aria-posinset takes the offset of the window into account', () => {
    const html = viewRowsHtml([zeile()], 5000, () => false, 803808);
    expect(html).toContain('aria-posinset="5001"');
  });

  it('an unknown total sets no aria-setsize instead of a wrong one', () => {
    // `-1` means "count in progress or failed". An
    // `aria-setsize="-1"` would be a false statement; leaving the attribute out is
    // the honest alternative.
    const html = viewRowsHtml([zeile()], 0, () => false, -1);
    expect(html).not.toContain('aria-setsize');
  });

  it('only C rows carry aria-expanded', () => {
    const zu = viewRowsHtml([zeile({ type: 'C', drilled: false })], 0, () => false, 10);
    const auf = viewRowsHtml([zeile({ type: 'C', drilled: true })], 0, () => false, 10);
    const blatt = viewRowsHtml([zeile({ type: 'N' })], 0, () => false, 10);
    expect(zu).toContain('aria-expanded="false"');
    expect(auf).toContain('aria-expanded="true"');
    expect(blatt).not.toContain('aria-expanded');
  });

  it('aria-selected mirrors the mark', () => {

    const html = viewRowsHtml([zeile()], 0, (n) => n === 'a', 10);
    expect(html).toContain('aria-selected="true"');
  });
});
