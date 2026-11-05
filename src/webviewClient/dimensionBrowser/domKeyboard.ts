/**
 * Keyboard handling of the Dimension Browser webview.
 *
 * Was block 5 of the former monolithic `dom.ts` (S2-12, review 2026-08-02) —
 * a pure move, no change in behavior. Two `document` keydown listeners in
 * unchanged registration order: first the arrow navigation, then
 * Esc / Ctrl+A / Del / Ctrl+C / Ctrl+V.
 *
 * Needs no `vscode` — none of the key actions talks to the host.
 *
 * WARNING: `dimBrowserDomWiring.test.ts` looks for the Ctrl+A and Ctrl+V marker
 * comments in THIS file (first occurrence!) and cuts the body off at the first
 * `\n  });` — the listeners must therefore stay at 2-character indentation, and
 * the marker texts must not appear verbatim up here in the file header.
 */
import { _updateSelectionFooter } from './footer';
import { clipboardNames, cutMarked, addNames, removeMarked } from './viewPath';
// `repaintMarks` under its own name: the old path (`./render`) already exports
// a function of the same name for the old mark state.
import { currentRows, repaintMarks as repaintViewMarks, paintMarkCount } from './viewPath';
import { markAll, clearMarks } from './viewMarks';
import { writeClipboard } from '../_shared/clipboardWrite';


type NavClip = Navigator & {
  clipboard?: {
    writeText?: (s: string) => Promise<void>;
    readText?: () => Promise<string>;
  };
};


function toClipboard(text: string): void {
  if (text) { void writeClipboard(text); }
}

export function initKeyboard(): void {
  // The arrow-key navigation of the old renderer went away with it: it
  // ran over `state._renderRows`, which the one path does not maintain — so it
  // has done nothing since that path started drawing. A navigation over the
  // rows of the VIEW would be a separate matter; otherwise only a dummy would
  // sit here.

  // Delete removes marked rows from the list; Ctrl+C/V clipboard ops.
  document.addEventListener('keydown', function (e) {
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae && ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ae && ae.isContentEditable)) { return; }

    // Esc clears (demasks) the marks. An OPEN overlay eats the key before this
    // handler: `escCloses` (capture phase, in saveMode.ts / domMdxModal.ts)
    // closes it and stops the event. The overlay branches used to sit here, but
    // never ran for the save modal — it opens with the focus in its name field,
    // and the guard above returns on INPUT.
    if (e.key === 'Escape') {
      clearMarks();
      repaintViewMarks();
      paintMarkCount();
      return;
    }

    // Ctrl/Cmd+A — select all visible rows (never the browser's whole-page text
    // select that leaks to the IDE). preventDefault first so the key is fully
    // consumed even when the table is empty.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      // Ctrl+A marks the rows of the VIEW.
      markAll(currentRows());
      repaintViewMarks();
      paintMarkCount();
      e.preventDefault();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // The same act as the "Remove" button — one mark, one layer. Without a
      // mark nothing happens (`removeMarked` decides that itself and says so).
      removeMarked();
      return;
    }

    // Ctrl/Cmd+C — copy marked element names to clipboard. Consume the key
    // unconditionally so it never falls through to the IDE's copy command.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      // The list comes from the VIEW, in drawing order.
      toClipboard(clipboardNames().join('\n'));
      return;
    }

    // Ctrl/Cmd+X — output the mark AND take it out of the set.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      const names = cutMarked();
      if (names.length) { toClipboard(names.join('\n')); }
      return;
    }

    // Ctrl/Cmd+V — paste clipboard text as new selection entries. Consume the
    // key unconditionally so it never falls through to the IDE's paste command.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      // Pasted names are ADDED (decision by flameY3T1, 2026-08-23: "one should
      // be able to add the same thing even if it is already in there").
      // `UNION(..., ALL)` keeps repetitions, so the same element may be added a
      // second time — pasting means adding, not replacing. No "N names not
      // found" message: it claimed a search in the loaded stock, but it is the
      // server that gets asked.
      const navClip: NavClip = navigator;
      if (!navClip.clipboard || !navClip.clipboard.readText) { return; }
      navClip.clipboard.readText().then(function (text) {
        const names = (text || '').split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
        if (names.length) { addNames(names); }
      }).catch(function () { /* read permission denied */ });
      return;
    }
  });
}
