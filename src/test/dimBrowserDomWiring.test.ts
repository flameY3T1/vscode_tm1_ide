import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Source guard for the event wiring of the dimension browser webview.
 *
 * The wiring layer cannot be executed without jsdom (there is no jsdom in the repo) —
 * the decisions behind it therefore live in `pure.ts`
 * (`splitPastedNames`/`pasteSeedRows`, with their own tests) and in `filterUi.ts`
 * (`applyDisplayAlias`, with its own tests). What is checked here is exactly the piece
 * that neither of the two covers: that the handler calls the right function at
 * all. Same pattern as `noManualBodyRelease.test.ts` — a source scan is
 * the only safeguard available at this seam.
 *
 * ⚠️ Since the split S2-12 (review 2026-08-02) the handlers live in SEVERAL
 * files; `dom.ts` is only the bootstrap now. Every marker below therefore carries its
 * file along. If a handler moves again, the path here has to move with it — if
 * `handlerBody` does not find its marker, the `toBeGreaterThanOrEqual(0)`
 * assertion fires. That is exactly the intent: this guard must never silently turn green.
 */

const DIM_BROWSER = path.resolve(__dirname, '..', 'webviewClient', 'dimensionBrowser');


/**
 * The body of ONE if-block starting at the first `{` after `marker`, by counting
 * braces up to the matching closing brace.
 *
 * `handlerBody` above is not enough here: all three branches (Del, Ctrl+C, Ctrl+V)
 * share the same `document.addEventListener('keydown', ...)` block, and the
 * first `\n  });` after it is the end of the WHOLE listener, not of the individual
 * branch (Important 4, final review).
 */

describe('dimensionBrowser wiring (source guard)', () => {

  // Dragging upwards was sluggish (report 2026-08-04). Three seams belong to it; the
  // decisions behind them are tested purely in `dimBrowserDragScroll.test.ts`.



  // The N/C/S quick filters hid rows without reporting the intent.
  // The composed expression then encoded the exclusion as a fixed `EXCEPT`
  // name list: set-equal today, but a C element created later shows up
  // again in an "only N" subset. All three toggles must go through the same
  // seam — one that forgets it does not stand out, because the result is correct.

  // The sort dropdown reordered the visible rows without reporting the
  // intent — `setSort` had no caller at all. As a result `c.sort` always stayed
  // `null`, the expression stood in base order, and the simulation let the
  // state silently fall back to static.

  // Index sorting is the one mode whose order is NOT produced in the client:
  // it comes back as `TM1SORTBYINDEX(…, ASC|DESC)` via `runSubsetMdx`.
  // If the sending branch were lost, the dropdown would sort
  // client-side again — and alphabetically at that, because the mode is drawn as a flat list.
  // Exactly the silent deviation the pilot is up against.

  // The alias is not a filter, but it changes the TEXT that is sorted by.
  // If it changes while a name sort is active, the sort has to run again AND
  // report its intent again — otherwise aliases would stand in name order,
  // and the expression would promise a `TM1SORT` that the server resolves differently.

  // The dropdown only offers modes that can be expressed as MDX. Level and type
  // had no `TM1SORT` equivalent: the expression stayed in base order,
  // the reordering went through as `moves`, and the MDX bar vanished without a word.
  // The same intent is served by the N/C/S toggles and the level filter — they
  // FILTER instead of producing an inexpressible order.


  // K22 (review 2026-08-02): switching the hierarchy releases the subset binding
  // (`setLoadedSubset(null, null)`), but left `_loadedSubsetAlias` in place. If
  // the new hierarchy happens to offer an attribute of the same name, the alias
  // of a subset that is no longer loaded is applied again — and on the next
  // save it is stamped onto whatever is visible at the moment.

  // K12 (review 2026-08-02): pasting leads into the list state — otherwise it is
  // invisible in the tree state, but has already defused the armed MDX.

  // "Insert above/below" is the position-exact twin of Ctrl+V and
  // must share its splitting — two regexes for the same input drift
  // apart with the first special case.

  // K15 (review 2026-08-02): the Shift range ran over the raw
  // `_orderedRows` index range and checked visibility only by NAME — an
  // occurrence in a collapsed subtree was marked as well as soon as the same name
  // was visible under another parent.

  // K9 (review 2026-08-02): the difference between list and tree state now lives in
  // `ctrlAMarkRows` (tested there) — here we only check that the handler actually calls it
  // and does not open two branches by hand again.

  // The bootstrap must actually still call the extracted blocks —
  // without this check a handler module would be unwired while the marker
  // tests above stayed green (they read the source, not the wiring).

  // "Duplicate occurrence" was removed on request on 2026-08-02. The
  // guard keeps the entry out: it was the only action that duplicated a row
  // without user input, and the path there (pasting from the
  // clipboard) covers the case more deliberately.
  it('no "Duplicate" entry anymore — neither in the menu nor as a handler', () => {
    // Removed on request on 2026-08-02: the only action that duplicated a row
    // without user input. The path there (pasting from the
    // clipboard) covers the case more deliberately.
    const bodySrc = fs.readFileSync(path.join(__dirname, '..', 'commands', 'dimension', 'dimensionBrowserBody.ts'), 'utf8');
    expect(bodySrc).not.toContain('ctx-duplicate');
    const ctxSrc = fs.readFileSync(path.join(DIM_BROWSER, 'viewCtx.ts'), 'utf8');
    expect(ctxSrc).not.toContain('ctx-duplicate');
  });

  it('"Copy names" hangs on the menu of the one path [viewCtx.ts]', () => {
    // With the removal of the old menu (`contextMenu.ts`) the entry
    // moved here — without the binding it would be a dead menu item.
    const ctxSrc = fs.readFileSync(path.join(DIM_BROWSER, 'viewCtx.ts'), 'utf8');
    expect(ctxSrc).toContain("el('ctx-copy-name')");
    expect(ctxSrc).toContain('bindCopyNames();');
  });

  it('the sort select field only offers expressible modes [dimensionBrowserBody.ts]', () => {
    // The successor of the old `sort-mode` guard: what is checked now is the
    // field that the one path serves (`vw-sort`). Every mode here must have an
    // equivalent in `viewMdx.ts` — an offered mode that the
    // expression cannot say would be a silent dead end.
    const bodySrc = fs.readFileSync(path.join(__dirname, '..', 'commands', 'dimension', 'dimensionBrowserBody.ts'), 'utf8');
    const start = bodySrc.indexOf('<select id="vw-sort"');
    expect(start).toBeGreaterThanOrEqual(0);
    const select = bodySrc.slice(start, bodySrc.indexOf('</select>', start));
    const modi = [...select.matchAll(/value="([a-z-]*)"/g)].map((m) => m[1]).filter(Boolean);
    expect(modi).toContain('hierarchy');
    expect(modi).toContain('index-asc');
    // Every mode must be in the intent type — otherwise `setSortIntent` does not
    // accept it in the first place, and the field would offer a silent dead end.
    const intents = fs.readFileSync(path.join(DIM_BROWSER, 'intents.ts'), 'utf8');
    const zeile = intents.slice(intents.indexOf("kind: 'sort'"));
    for (const m of modi) {
      // `none` is the withdrawal, not an intent — that is why it is not in the type.
      if (m === 'none') { continue; }
      expect(zeile.slice(0, 300), `Sortiermodus ohne Absicht: ${m}`).toContain(`'${m}'`);
    }
  });
});
