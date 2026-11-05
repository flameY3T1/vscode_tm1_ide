/**
 * Escape aborts an open modal, the way Enter finishes it (flameY3T1, 2026-09-18).
 *
 * The listener sits on `document` in the CAPTURE phase, not on the modal: a
 * click on a modal's backdrop or on a non-focusable label moves focus to
 * `<body>`, and a listener bound to the modal element would then never see the
 * key. The open-check is the CSS class the modal already toggles, so there is
 * no second piece of state to keep in sync.
 *
 * Capture + `stopImmediatePropagation` keeps a background Escape handler of the
 * same webview (context menu, cell editor, selection clear) from also firing
 * while a modal is on top.
 */
export function escCloses(modal: HTMLElement, close: () => void, openClass = 'visible'): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !modal.classList.contains(openClass)) { return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }, true);
}
