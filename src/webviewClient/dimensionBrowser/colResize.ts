export {};

// Do NOT write `MIN_COL_PX`/`DEFAULT_COL_PX` down here a second time: two
// numbers that mean the same thing eventually drift apart.
import { setColumnWidth, MIN_COL_PX, DEFAULT_COL_PX } from './attrColumns';

/**
 * The new width from the start width and the mouse travel.
 *
 * `mouseDelta` is the travel to the RIGHT in pixels (`clientX - startX`), and it
 * is SUBTRACTED: the handle sits on the left of the column, dragging left
 * makes it wider (instruction flameY3T1, 2026-08-26). The gesture is "pull
 * outward", like at the corner of a window.
 *
 * The grabbed edge does NOT move along: under `table-layout: fixed` the left
 * edge of a column stays fixed, it always grows to the right. This is known
 * and accepted — the direction of the gesture counts for more here than
 * carrying the line along.
 *
 * Separate from the DOM wiring, so that the calculation can be checked
 * without a mouse.
 */
export function computeWidth(start: number, mouseDelta: number): number {
  return Math.max(MIN_COL_PX, Math.round(start - mouseDelta));
}

let bound = false;

/**
 * Wire up the drag area.
 *
 * The handle sits in the `<thead>`, the row drag gesture (`initViewDrag`,
 * `draggable="true"`) in the `<tbody>` — the two do not meet. The
 * header row is NOT `draggable`.
 *
 * While dragging, only the `<col>` is touched, not the rows: the
 * widths live in the `colgroup`, so that an adjustment changes one element and
 * not 10,000 cells (see `viewRender.ts#colgroupHtml`).
 *
 * Only on release is the state written (`setColumnWidth`) and
 * redrawn — during dragging every intermediate value would be a
 * save operation.
 *
 * `clickBound` prevents wiring up twice: `startView` calls the
 * initialization of the view controls anew on every dimension switch,
 * but the `<thead>` remains the same DOM node.
 *
 * `remember` (Task 8): called after writing to the state, so that the
 * caller can report the new width to the host (`saveAttrColumns`). Without
 * a name/value parameter of its own — the caller rereads the whole state,
 * the same way as with the selection callback.
 *
 * POINTER CAPTURE (fix round 2, finding 5): when widening, the mouse leaves
 * the iframe in the main direction — formerly to the right (handle on the right
 * edge), since 2026-08-26 to the left (handle on the left, leftwards = wider).
 * So the trap remains the same, only the compass direction has changed. A
 * `mouseup` outside never reaches the `document` of the iframe — `move`/`release`
 * stayed registered, and the column kept dragging on the next mouse entry
 * without a pressed button. `setPointerCapture` binds the pointer to the handle,
 * `lostpointercapture` ends the gesture even if the release
 * happens elsewhere. A second latch for the case that it gets lost anyway: a
 * `pointermove` WITHOUT a pressed button (`buttons === 0`) ends the gesture.
 */
export function initColResize(redraw: () => void, remember?: () => void): void {
  if (bound) { return; }
  const head = document.getElementById('table-head');
  const cols = document.getElementById('table-cols');
  if (!head || !cols) { return; }
  bound = true;
  head.addEventListener('pointerdown', (ev: Event) => {
    const pe = ev as PointerEvent;
    const target = ev.target as HTMLElement | null;
    const name = target && target.classList.contains('vw-col-grip') ? target.dataset.col : undefined;
    if (!name) { return; }
    // Own binding after the check: the narrowing to `string` otherwise does not
    // survive the jump into a hoisted function declaration.
    const columnName: string = name;
    ev.preventDefault(); // otherwise the browser starts a text selection
    const startX = pe.clientX;
    const th = target!.closest('th') as HTMLElement | null;
    const startWidth = th ? th.getBoundingClientRect().width : DEFAULT_COL_PX;
    const thIndex = Array.prototype.indexOf.call(head.querySelectorAll('th'), th);
    const column = cols.querySelectorAll('col')[thIndex] as HTMLElement | undefined;

    // The capture is the normal case; if it fails (older environment, test double),
    // the old way via the `document` remains — then the second latch in
    // `move` applies.
    let captured = false;
    try {
      if (typeof target!.setPointerCapture === 'function') {
        target!.setPointerCapture(pe.pointerId);
        captured = true;
      }
    } catch { /* no capture, no harm — see above */ }
    const source: {
      addEventListener: (t: string, h: (e: Event) => void) => void;
      removeEventListener: (t: string, h: (e: Event) => void) => void;
    } = captured ? (target! as unknown as typeof source) : (document as unknown as typeof source);

    let done = false;
    // The width last ACTUALLY drawn. `release` does not recalculate from the end
    // event: `lostpointercapture` carries no usable pointer position, and the
    // state is meant to save what was visible.
    let lastWidth = computeWidth(startWidth, 0);

    // Function declarations, not `const`: `move` calls `release` and `release`
    // unregisters `move` — one of the two would otherwise sit in its own
    // dead zone.
    function move(e: Event): void {
      const m = e as PointerEvent;
      // No button pressed any more: the release happened somewhere outside
      // and never arrived here.
      if (m.buttons === 0) { release(); return; }
      lastWidth = computeWidth(startWidth, m.clientX - startX);
      if (column) { column.style.width = lastWidth + 'px'; }
    }
    function release(): void {
      if (done) { return; }
      done = true;
      source.removeEventListener('pointermove', move);
      source.removeEventListener('pointerup', release);
      source.removeEventListener('pointercancel', release);
      source.removeEventListener('lostpointercapture', release);
      try {
        if (captured && typeof target!.releasePointerCapture === 'function') {
          target!.releasePointerCapture(pe.pointerId);
        }
      } catch { /* already released */ }
      // Write to the state only at the end: during dragging every
      // intermediate value would be a save operation.
      setColumnWidth(columnName, lastWidth);
      redraw();
      remember?.();
    }

    source.addEventListener('pointermove', move);
    source.addEventListener('pointerup', release);
    source.addEventListener('pointercancel', release);
    source.addEventListener('lostpointercapture', release);
  });
}
