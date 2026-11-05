import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildDimensionBrowserBody } from '../commands/dimension/dimensionBrowserBody';
import type { L10nMap } from '../webviewClient/_shared/l10n';

// Every label resolves to its own key — enough for markup assertions, and it
// keeps this test independent of the l10n bundle (and of `vscode.l10n`).
const T = new Proxy({}, { get: (_t, k) => String(k) }) as L10nMap;

const ICON_ROOT = path.resolve(__dirname, '..', '..', 'media', 'icons');

/** Renders the body while recording which glyphs it asked for. */
function renderRecording(): string[] {
  const asked: string[] = [];
  buildDimensionBrowserBody(T, (name) => { asked.push(name); return `<img data-icon="${name}">`; });
  return asked;
}

describe('dimension browser body icons', () => {
  it('gives the type quick-filters their glyphs', () => {
    const html = buildDimensionBrowserBody(T, (name) => `[${name}]`);
    expect(html).toContain('id="quick-only-n" title="quickOnlyNTitle" aria-label="quickOnlyN">[only-n-elements]<');
    expect(html).toContain('id="quick-only-c" title="quickOnlyCTitle" aria-label="quickOnlyC">[only-c-elements]<');
    expect(html).toContain('id="quick-only-s" title="quickOnlySTitle" aria-label="quickOnlyS">[only-s-elements]<');
  });

  // Dropped 2026-08-26: resetting happens via "All"/"Elements", which set the
  // base anew. The button must not live on invisibly either — its
  // handler in `dom.ts` accessed it hard via `as HTMLButtonElement`.
  it('has no reset-filters button any more', () => {
    const html = buildDimensionBrowserBody(T, (name) => `[${name}]`);
    expect(html).not.toContain('clear-filters-btn');
    expect(html).not.toContain('[clear-filter]');
  });

  // Glyph-only: the label must not sit next to the icon any more, but it still
  // has to reach a screen reader — hence aria-label, not a bare title.
  it('carries no visible label text on the filter buttons', () => {
    const html = buildDimensionBrowserBody(T, () => '<img>');
    for (const id of ['quick-only-n', 'quick-only-c', 'quick-only-s']) {
      const btn = new RegExp(`<button[^>]*id="${id}"[^>]*>(.*?)</button>`).exec(html);
      expect(btn, id).not.toBeNull();
      // Nothing but the glyph between the tags — no stray text node.
      expect(btn![1].replace(/<[^>]*>/g, '').trim(), id).toBe('');
      expect(btn![0], id).toContain('aria-label=');
    }
  });

  // A misspelled name renders a broken <img> and nothing else — no error, no
  // console warning. Pin every requested glyph to a file that actually ships.
  it('requests only glyphs that exist in BOTH theme folders', () => {
    const asked = renderRecording();
    expect(asked.length).toBeGreaterThan(0);
    const missing = asked.flatMap((name) => ['light', 'dark']
      .filter((theme) => !fs.existsSync(path.join(ICON_ROOT, theme, `${name}.svg`)))
      .map((theme) => `${theme}/${name}.svg`));
    expect(missing).toEqual([]);
  });

  it('falls back to no markup when no renderer is supplied', () => {
    const html = buildDimensionBrowserBody(T);
    expect(html).toContain('id="quick-only-n" title="quickOnlyNTitle" aria-label="quickOnlyN">');
    expect(html).not.toContain('<img');
  });
});

describe('Toolbar in the Architect layout', () => {
  it('shows All, Keep only and Delete visibly', () => {
    const html = buildDimensionBrowserBody(T);
    expect(html).toContain('id="btn-show-all"');
    expect(html).toContain('id="btn-keep-marked"');
    expect(html).toContain('id="btn-remove-marked"');
  });

  it('no longer hides the mark actions via style', () => {
    const html = buildDimensionBrowserBody(T);
    const strip = html.slice(html.indexOf('id="mark-actions"'), html.indexOf('id="mark-count"'));
    expect(strip).not.toContain('display:none');
  });

  // In the list state the mark actions are the primary controls and must
  // never hang under a greyed-out ancestor (an `opacity:1` on the child does not
  // cancel the ancestor's transparency during compositing). Formerly
  // #mark-actions stood IN the filter bar and needed a
  // `:not(#mark-actions)` exception for that; since 2026-08-01 it is a row of its own —
  // the separation is therefore structural instead of a selector exception. A
  // jsdom-free substitute for "click All while the bar is muted".

  // Drill▾ is gone (2026-08-01): the same actions hang on the context menu of the
  // clicked row, where the reference to the row is unambiguous.
  it('has no Drill button in the bar any more', () => {
    const html = buildDimensionBrowserBody(T);
    expect(html).not.toContain('btn-drill-menu');
    expect(html).not.toContain('drill-menu-panel');
  });
});

/**
 * The type filters of the NEW loading path are LETTERS, not a glyph
 * (decision flameY3T1, 2026-08-26: "more harmonious").
 *
 * The test checks both together — character present AND glyph gone. Checking only the
 * character would pass green even if an `<img>` still hangs next to it;
 * exactly that duplication would be the regression.
 */
describe('Type filters of the new path', () => {
  const FALL: Array<[string, string]> = [
    ['vw-quick-n', 'N'], ['vw-quick-c', 'C'], ['vw-quick-s', 'S'],
  ];

  it.each(FALL)('%s shows the letter %s instead of a glyph', (id, zeichen) => {
    const html = buildDimensionBrowserBody(T, (name) => `[${name}]`);
    const btn = new RegExp(`<button[^>]*id="${id}"[^>]*>(.*?)</button>`).exec(html);
    expect(btn, id).not.toBeNull();
    expect(btn![1]).toBe(zeichen);
    // NO class of their own (change flameY3T1, 2026-08-26): only then does the
    // same rule `.mark-bar button` apply to them as to the buttons to their left,
    // and they stand in the row with the same shape and size. Any class of their own
    // here would again be a separate cut.
    expect(btn![0]).not.toContain('class=');
  });

  it('no longer requests a type glyph for the new path', () => {
    // The three `only-*-elements` may occur only ONCE (old path),
    // not twice.

    const asked = renderRecording().filter((n) => /^only-[ncs]-elements$/.test(n));
    expect(asked).toEqual(['only-n-elements', 'only-c-elements', 'only-s-elements']);
  });
});
