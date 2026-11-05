import { describe, it, expect } from 'vitest';
import { viewRowHtml, viewRowsHtml } from '../webviewClient/dimensionBrowser/viewRender';
import type { DisplayRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';

const z = (p: Partial<DisplayRow>): DisplayRow => ({
  name: 'a', caption: 'a', type: 'N', level: 0, parent: null, ancestors: [],
  drilled: false, depth: 0, key: 'a', ...p,
});

describe('viewRowHtml', () => {
  it('carries the POSITION as the row identifier, not the key', () => {
    // The occurrence key is NUL-separated, and `&#0;` is a parse error in HTML5:
    // the browser replaces it with U+FFFD. A key in the
    // attribute would therefore come back ALTERED and the click would hit the wrong
    // element. The position in the window is unique, short and needs no escaping.
    expect(viewRowHtml(z({ key: 'sum\x00a' }), 3)).toContain('data-idx="3"');
  });

  it('does not let the key into the HTML at all', () => {
    const html = viewRowHtml(z({ key: 'sum\x00a' }), 0);
    expect(html).not.toContain('\x00');
    expect(html).not.toContain('&#0;');
  });

  it('indents according to depth', () => {
    expect(viewRowHtml(z({ depth: 2 }), 0)).toContain('padding-left:38px');
  });

  it('keeps a distance from the edge even at depth 0', () => {
    // The name cell sets `padding-left` itself and thereby overrides the
    // 6 px from `.vw-row td` — at depth 0 it sat flush against the window edge
    // (click test 2026-08-23). The margin is ADDED, it is not the first
    // indentation step.
    expect(viewRowHtml(z({ depth: 0 }), 0)).toContain('padding-left:10px');
    expect(viewRowHtml(z({ depth: 1 }), 0)).toContain('padding-left:24px');
    expect(viewRowHtml(z({ depth: 0 }), 0)).not.toBe(viewRowHtml(z({ depth: 2 }), 0));
  });

  it('shows a triangle ONLY on a consolidation', () => {
    expect(viewRowHtml(z({ type: 'C' }), 0)).toContain('vw-twisty');
    expect(viewRowHtml(z({ type: 'N' }), 0)).not.toContain('vw-twisty');
  });

  it('distinguishes expanded and collapsed', () => {
    expect(viewRowHtml(z({ type: 'C', drilled: true }), 0)).toContain('vw-open');
    expect(viewRowHtml(z({ type: 'C', drilled: false }), 0)).not.toContain('vw-open');
  });

  it('shows the caption, not the name', () => {
    expect(viewRowHtml(z({ name: 'a', caption: 'Alpha' }), 0)).toContain('Alpha');
  });

  it('defuses HTML in the element name', () => {
    // TM1 element names may contain `<` and `&`. Unprotected, that would be
    // an injection into the webview.
    const html = viewRowHtml(z({ name: '<img>', caption: 'a & b' }), 0);
    expect(html).not.toContain('<img>');
    expect(html).toContain('a &amp; b');
  });

  it('numbers the rows consecutively', () => {
    const out = viewRowsHtml([z({ key: 'a' }), z({ name: 'b', caption: 'b', key: 'b' })]);
    expect(out.split('<tr').length - 1).toBe(2);
    expect(out).toContain('data-idx="0"');
    expect(out).toContain('data-idx="1"');
  });
});

/**
 * Consolidations in bold — the same weight as in the Cube Viewer
 * (`.cube-table td.cell-consolidated`, font-weight 600).
 *
 * A SEPARATE class `vw-c`, not the old vocabulary `type-C`: `.type-N` and
 * `.type-S` stand unscoped in the stylesheet and attach a `::before` symbol to
 * everything that carries them — on a `<tr>` that would be a green dot in every
 * leaf row.
 */
describe('consolidations are drawn as such', () => {
  const z = (name: string, type: 'N' | 'C' | 'S') => ({
    name, caption: name, type, level: 0, parent: null,
    ancestors: [], drilled: false, depth: 0, key: name,
  });

  it('gives consolidations the class vw-c', () => {
    const html = viewRowsHtml([z('sum', 'C')] as never, 0);
    expect(html).toContain('class="vw-row vw-c"');
  });

  it('does NOT give it to leaves and strings', () => {
    const html = viewRowsHtml([z('a', 'N'), z('t', 'S')] as never, 0);
    expect(html).not.toContain('vw-c');
  });

  it('does NOT use the unscoped type vocabulary', () => {
    // `.type-N::before` would otherwise paint a dot into every row.
    const html = viewRowsHtml([z('a', 'N'), z('sum', 'C')] as never, 0);
    expect(html).not.toContain('type-N');
    expect(html).not.toContain('type-C');
  });
});
