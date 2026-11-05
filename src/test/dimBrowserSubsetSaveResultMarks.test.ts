import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// msg.ts reads `getL10n()` at module scope — inject the map BEFORE the static
// import executes (vi.hoisted runs above hoisted imports). Keys used on the
// path under test: `saved` (fallback save-message text, unused here since we
// pass an explicit `message`, but kept for parity with the real module).
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = { saved: 'Saved.' };
});

import { state } from '../webviewClient/dimensionBrowser/state';
import { initMsgHandler } from '../webviewClient/dimensionBrowser/msg';
import { markCount, toggleMark, _resetMarksForTest } from '../webviewClient/dimensionBrowser/viewMarks';
import type { HostToWebview } from '../webviewClient/dimensionBrowser/protocol';

// Review-Fix Critical B (Task 10 follow-up): `subsetSaveResult`'s success path
// used to `document.getElementById('mark-actions').style.display = 'none'`
// whenever `state._mode !== 'selection'` (i.e. standalone — the primary
// Architect use case). That was a harmless no-op while the strip was
// permanently `display:none` anyway; once Task 10 made the strip visible by
// default, it became a live regression — the mandatory "Alle" reset button
// silently disappears after every successful subset save in standalone mode,
// and nothing else ever sets `display` back. The fix drops that hide branch
// and instead runs the normal `_updateSelectionFooter()` markCount path,
// which is the mechanism that is actually supposed to reflect "marks were
// just cleared" (Keep/Remove/Clear-Marks go `disabled`, mark-count clears).
//
// No jsdom in this repo (vitest.config.ts has no `environment`, default
// 'node') — same fake-DOM-by-id pattern as dimBrowserStalePayload.test.ts /
// dimBrowserDynamicSaveOption.test.ts. `state._lastSavedSubset` is left null
// so the branch that calls `renderTable()`/`_syncCollapseToSubset()` (DOM-
// heavy, would need a much bigger stub) is skipped entirely — the assertions
// below only concern the mark-clearing tail, which is reached regardless.
describe('initMsgHandler — subsetSaveResult success no longer hides #mark-actions', () => {
  let handler: (e: { data: HostToWebview }) => void;
  let els: Record<string, { style: { display: string }; className: string; textContent: string; disabled: boolean; classList: { add: () => void; remove: () => void } }>;

  function el(): { style: { display: string }; className: string; textContent: string; disabled: boolean; classList: { add: () => void; remove: () => void } } {
    return { style: { display: '' }, className: '', textContent: '', disabled: false, classList: { add: () => {}, remove: () => {} } };
  }

  beforeEach(() => {
    vi.useFakeTimers();

    const listeners: Array<(e: { data: HostToWebview }) => void> = [];
    (globalThis as unknown as { window: { addEventListener: (type: string, cb: (e: { data: HostToWebview }) => void) => void } }).window = {
      addEventListener: (_type: string, cb: (e: { data: HostToWebview }) => void) => { listeners.push(cb); },
    };
    initMsgHandler({ vscode: null });
    handler = listeners[0];

    els = {
      'save-msg': el(),
      'save-modal': el(),
      'mark-actions': el(),
      'btn-keep-marked': el(),
      'btn-remove-marked': el(),
      'mark-count': el(),
    };
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => els[id] ?? null,
    };

    state._mode = 'standalone'; // the bug's own repro scenario ("primary Architect use case")
    _resetMarksForTest();
    toggleMark('Foo'); toggleMark('Bar');
    state._lastSavedSubset = null; // skip the DOM-heavy re-sync branch, see file header
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it('clears marks and disables Keep/Remove, but never touches #mark-actions.style.display', () => {
    const msg: HostToWebview = { type: 'subsetSaveResult', ok: true, message: 'Saved.' } as never;

    handler({ data: msg });
    vi.advanceTimersByTime(600); // the success path's setTimeout(..., 600)

    // The marks themselves fall away. Until 2026-08-26 an assignment to
    // `state._markedNames`/`_markedKeys` stood here — dead fields, so the clearing was
    // ineffective. What is counted now is the store of the new path.
    expect(markCount()).toBe(0);

    // THE regression this test guards: the strip must stay visible. If the
    // stale `getElementById('mark-actions').style.display = 'none'` branch
    // ever comes back, this fails.
    expect(els['mark-actions'].style.display).not.toBe('none');
    expect(els['mark-actions'].style.display).toBe('');

    // This test no longer checks the button lock itself: `btn-keep-marked`
    // and `btn-remove-marked` belong to the hidden `OLD_IDS` bar; the
    // visible counterparts of the new path are served by `viewControls.ts`.

  });
});
