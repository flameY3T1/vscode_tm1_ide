/**
 * Drag and drop in the new load path.
 *
 * A module of its own next to `dragDrop.ts`, not a reuse of it: that one
 * works on `state._orderedRows`/`_manualRows` and draws with
 * `renderTable()` - the old renderer, in the same table body. It is
 * therefore switched off in the new path (see `initDragDrop`).
 *
 * Here, moving is what it is in the model: a MANUAL ORDER
 * (`viewPath#moveNamesTo`), committed as the `explicit` base - the same
 * thing as "insert above/below", only with a handle instead of the
 * clipboard.
 */
import { markedNames, isMarked } from './viewMarks';
import { computeDragNames } from './pure';

/**
 * What dragging needs - as callbacks, NOT as imports.
 *
 * `viewDrag` needs `moveNamesTo`/`currentRows` from `viewPath`, and `viewPath`
 * needs `initViewDrag` - a cycle that `npm run lint:deps` reports as a
 * build breaker. The same solution as with `ViewControlCallbacks`.
 */
export interface ViewDragCallbacks {
  /** The name of the row at this display position, or `null`. */
  nameAt: (idx: number) => string | null;
  moveNamesTo: (target: string, below: boolean, names: readonly string[]) => void;
}

let bound = false;
/** What is currently being dragged - empty if nothing. */
let dragged: string[] = [];

function el(id: string): HTMLElement | null { return document.getElementById(id); }

const LINES = ['vw-drop-above', 'vw-drop-below'];

/**
 * Attach the insertion line to exactly ONE row.
 *
 * Cleared via `querySelectorAll` instead of remembering the previous row: a
 * redraw during dragging (reloading while scrolling) would fool the
 * remembered reference, and the line would stay on a row that no longer exists.
 */
function showLine(body: HTMLElement, target: Element | null, below: boolean): void {
  const all = body.querySelectorAll('tr[data-idx]');
  for (let i = 0; i < all.length; i++) {
    for (const k of LINES) { all[i]!.classList.remove(k); }
  }
  if (target) { target.classList.add(below ? 'vw-drop-below' : 'vw-drop-above'); }
}

/** The row under the pointer, and whether it is in its LOWER half. */
function targetOf(
  e: Event, nameAt: (i: number) => string | null,
): { name: string; below: boolean; tr: Element } | null {
  const ev = e as unknown as {
    target?: { closest?(s: string): HTMLElement | null };
    clientY: number;
  };
  const tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-idx]') : null;
  if (!tr) { return null; }
  const name = nameAt(Number(tr.getAttribute('data-idx')));
  if (!name) { return null; }
  // Upper half means before, lower half means after - the same rule that every
  // list with an insertion line uses.
  const r = tr.getBoundingClientRect();
  return { name, below: ev.clientY > r.top + r.height / 2, tr };
}

export function initViewDrag(cbs: ViewDragCallbacks): void {
  if (bound) { return; }
  const body = el('table-body');
  if (!body) {
    console.warn('[dimbrowser] table-body missing — dragging on the new path not bound');
    return;
  }
  bound = true;

  body.addEventListener('dragstart', (e: Event) => {
    const target = targetOf(e, cbs.nameAt);
    if (!target) { return; }
    // A MARKING that contains the dragged row is taken along - whoever marks
    // six and drags one of them means the six (the same rule as
    // "only this element", `computeDragNames`).
    dragged = isMarked(target.name) ? computeDragNames(target.name, markedNames()) : [target.name];
    const dt = (e as DragEvent).dataTransfer;
    if (dt) {
      // `effectAllowed` MUST match the `dropEffect` of the dragover, otherwise
      // the browser internally sets the effect to `none` and `drop` NEVER fires -
      // silently (the same trap is documented in `dragDrop.ts`).
      dt.effectAllowed = 'move';
      try { dt.setData('text/plain', dragged.join('\n')); } catch { /* webview quirk */ }
    }
  });

  body.addEventListener('dragover', (e: Event) => {
    if (!dragged.length) { return; }
    e.preventDefault();
    const dt = (e as DragEvent).dataTransfer;
    if (dt) { dt.dropEffect = 'move'; }
    // Show WHERE it falls - otherwise the user guesses whether the row lands
    // above or below the target row.
    const target = targetOf(e, cbs.nameAt);
    showLine(body, target ? target.tr : null, !!target && target.below);
  });

  body.addEventListener('drop', (e: Event) => {
    if (!dragged.length) { return; }
    e.preventDefault();
    const target = targetOf(e, cbs.nameAt);
    const names = dragged;
    dragged = [];
    showLine(body, null, false);
    if (!target) { return; }
    cbs.moveNamesTo(target.name, target.below, names);
  });

  // Without this, an aborted gesture would remain as "something is being dragged", and
  // the next `dragover` anywhere in the window would behave like a target.
  body.addEventListener('dragend', () => { dragged = []; showLine(body, null, false); });
}

/** For tests only. */
export function _resetViewDragForTest(): void { bound = false; dragged = []; }
