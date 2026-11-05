import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildDimensionBrowserBody } from '../commands/dimension/dimensionBrowserBody';
import { DIMENSION_BROWSER_CSS } from '../commands/dimension/dimensionBrowserCss';
import type { L10nMap } from '../webviewClient/_shared/l10n';

/**
 * Source-scan guard against dead selectors in the dimension browser CSS.
 *
 * K26 (review 2026-08-02): `.pane-header-actions` (with `#btn-sel-up`/
 * `#btn-sel-down`), `.col-type` and `.row-selected` survived the pane merge and the
 * Architect rework respectively as corpses — markup and client code had long
 * stopped knowing them. Nobody notices such rules: they cost nothing,
 * break nothing and mislead the next reader. There is no jsdom
 * in the repo, so a source comparison is the only safeguard open to this
 * seam — the same pattern as `dimBrowserDomWiring.test.ts` and
 * `noManualBodyRelease.test.ts`.
 *
 * Rule: every `#id` and `.class` selector in the CSS must appear in the body markup OR in
 * a client module (`webviewClient/dimensionBrowser/*.ts`, which sets classes at
 * runtime). What comes from outside is listed with a reason in
 * `EXTERNAL_CLASSES` — do NOT delete a rule just because no id matches.
 */

const T = new Proxy({}, { get: (_t, k) => String(k) }) as L10nMap;

const CLIENT_DIR = path.resolve(__dirname, '..', 'webviewClient', 'dimensionBrowser');
const ICONS_TS = path.resolve(__dirname, '..', 'webviews', 'webviewIcons.ts');
// The subset picker's filterable dropdown builds its classes there.
const COMBO_TS = path.resolve(__dirname, '..', 'webviewClient', '_shared', 'filterCombo.ts');

/**
 * Classes that no module of this webview writes out literally:
 *  • `vscode-*` is set by VS Code itself on `<body>` (theme variant),
 *  • `type-N`/`type-S` are created in `render.ts` as `'type-' + esc(elem.Type)` —
 *    composed, never spelled out. There is NO `type-C`: for
 *    consolidations `render.ts` deliberately renders no badge (the twisty ▶/▼ already
 *    says it), which is why the CSS rule for it is gone too (S1-9, 2026-08-02).
 */
const EXTERNAL_CLASSES = new Set([
  'vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light',
  'type-N', 'type-S',
]);

/** Strip comments — they mention removed selectors to explain WHY. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Strip declaration blocks so that `#f48771` (a colour value) does not count as an id. */
function selectorsOnly(css: string): string {
  let out = stripComments(css);
  for (;;) {
    const next = out.replace(/\{[^{}]*\}/g, ' ');
    if (next === out) { return out; }
    out = next;
  }
}

function readDir(dir: string): string {
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

/**
 * Remove comments before the client code becomes the haystack.
 *
 * Reason (2026-08-30): `.row-active` had been dead for a long time — the class was
 * no longer set anywhere, but still stood in a comment above an
 * unused function. So `haystack.includes()` found it and the guard
 * stayed silently green. It was only noticed when the function was deleted
 * during a cleanup. A guard that a comment satisfies checks the
 * mention instead of the thing itself.
 */
function ohneKommentare(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('dimensionBrowserCss — no orphaned selectors', () => {
  const selectors = selectorsOnly(DIMENSION_BROWSER_CSS);
  // Body markup + everything that touches classes/ids at runtime. `webviewIcons.ts`
  // supplies the `wv-icon`/`light-only`/`dark-only` wrapper of the glyphs.
  const haystack = [
    buildDimensionBrowserBody(T, (n) => `<img data-icon="${n}">`),
    ohneKommentare(readDir(CLIENT_DIR)),
    ohneKommentare(fs.readFileSync(COMBO_TS, 'utf8')),
    fs.readFileSync(ICONS_TS, 'utf8'),
  ].join('\n');

  it('every referenced id exists in the markup or in the client code', () => {
    const ids = new Set(Array.from(selectors.matchAll(/#([A-Za-z][-\w]*)/g), (m) => m[1]));
    expect(ids.size).toBeGreaterThan(10); // self-test: the regex matches at all
    expect([...ids].filter((id) => !haystack.includes(id))).toEqual([]);
  });

  it('every referenced class is set somewhere', () => {
    const cls = new Set(Array.from(selectors.matchAll(/\.([A-Za-z][-\w]*)/g), (m) => m[1]));
    expect(cls.size).toBeGreaterThan(10);
    const orphans = [...cls].filter((c) => !EXTERNAL_CLASSES.has(c) && !haystack.includes(c));
    expect(orphans).toEqual([]);
  });

  // The three concrete corpses from K26 — pinned down by name so that a
  // reappearance does not just read as "some selector". What is checked is the
  // comment-free CSS: the comments at those places NAME the removed
  // rules, that is the whole point.
  it('the corpses of the pane merge are gone', () => {
    const css = stripComments(DIMENSION_BROWSER_CSS);
    expect(css).not.toContain('pane-header-actions');
    expect(css).not.toContain('btn-sel-up');
    expect(css).not.toContain('btn-sel-down');
    expect(css).not.toContain('col-type');
    expect(css).not.toContain('row-selected'); // also covers --db-row-selected
  });
});

describe('dimensionBrowserCss — initial state of the pane', () => {
  // K26: the pane must NOT start visible. It is revealed solely by
  // the `ready` phase in `viewPhase.ts` (sets inline `display:flex`); without the
  // `display:none` start value the header paints "Available 0 / 0" before
  // any data is there at all. (Until the split S2-11 the handler lived in `msg.ts`,
  // until S2-17 in `msgSession.ts`.)
  it('#pane-single starts invisible', () => {
    const rule = /#pane-single\s*\{([^}]*)\}/.exec(DIMENSION_BROWSER_CSS);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/display:\s*none/);
    // The rest of the flex column must stay in place — otherwise the layout
    // collapses as soon as the `ready` phase switches to `flex`.
    expect(rule![1]).toMatch(/flex-direction:\s*column/);
    expect(rule![1]).toMatch(/min-height:\s*0/);
  });

  // S2-17 (2026-08-02): the switch moved from `msgSession.ts` to `viewPhase.ts`
  // — to where the pane stands together with the four other elements of the
  // window in ONE complete table. The guard points there too; what is checked
  // stays the same as since S2-11: exactly ONE module switches the pane.
  // (Until S2-11 the handler lived in `msg.ts`.)
  const PANE_OWNER = 'viewPhase.ts';
  it('only viewPhase.ts reveals the pane', () => {
    const owner = fs.readFileSync(path.join(CLIENT_DIR, PANE_OWNER), 'utf8');
    expect(owner).toContain("'pane-single'");
    const others = fs.readdirSync(CLIENT_DIR)
      .filter((f) => f !== PANE_OWNER)
      .filter((f) => fs.readFileSync(path.join(CLIENT_DIR, f), 'utf8').includes('pane-single'));
    expect(others).toEqual([]);
  });

  // The phase table is the actual fix for K26: it is COMPLETE, every
  // phase switches all five elements. A branch that switches only "its own" was
  // the cause — a hollowed-out `viewPhase.ts` (a phase that leaves out an element)
  // would leave the guard above silently green.
  it('every phase switches all five elements', () => {
    const src = fs.readFileSync(path.join(CLIENT_DIR, PANE_OWNER), 'utf8');
    const table = /const PHASE:[\s\S]*?\n};/.exec(src);
    expect(table, 'PHASE-Tabelle nicht gefunden — Wächter ins Leere gelaufen').not.toBeNull();
    for (const phase of ['loading', 'error', 'ready']) {
      const entry = new RegExp(`\\b${phase}:\\s*\\{([\\s\\S]*?)\\}`).exec(table![0]);
      expect(entry, `Phase fehlt in PHASE: ${phase}`).not.toBeNull();
      for (const key of ['loading', 'errorBanner', 'placeholder', 'paneSingle', 'tableContainer']) {
        expect(entry![1], `Phase '${phase}' schaltet '${key}' nicht`).toContain(`${key}:`);
      }
    }
  });
});

describe('#mark-actions — markup and code agree', () => {
  // K26: the markup lost its `style="display:none"` during the Architect rework.
  // That is CORRECT — since Task 10 no module hides the
  // bar any more either (the visible row list IS the selection; "All/Keep
  // only/Delete" are the primary controls in both modes). The guard
  // keeps both sides together: if hiding comes back, the start value
  // in the markup must come along — and vice versa.
  it('no client module sets the visibility of #mark-actions', () => {
    const client = readDir(CLIENT_DIR);
    // Mentions are allowed (comments), a `style.display` on it is not.
    expect(client).not.toMatch(/getElementById\('mark-actions'\)[^\n]*style\.display/);
  });

  it('the markup consequently starts visible', () => {
    const html = buildDimensionBrowserBody(T);
    const strip = html.slice(html.indexOf('id="mark-actions"'), html.indexOf('id="mark-count"'));
    expect(strip).not.toContain('display:none');
  });
});
