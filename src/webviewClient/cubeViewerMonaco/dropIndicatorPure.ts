/**
 * Pure drop geometry for dragging dimensions between the axis zones
 * (no DOM, no vscode). Consumer: axis.ts.
 */

/** Excerpt of `DOMRect` that the index computation needs. */
export interface DropRect { left: number; right: number; top: number; bottom: number }

interface Band { top: number; bottom: number; from: number; to: number }

/** Group the chips of a wrapping zone into row bands. Neighbours whose
 *  vertical extents overlap belong to the same row. */
function _bands(rects: DropRect[]): Band[] {
  const bands: Band[] = [];
  rects.forEach((r, i) => {
    const cur = bands[bands.length - 1];
    if (cur && r.top < cur.bottom && r.bottom > cur.top) {
      cur.top = Math.min(cur.top, r.top);
      cur.bottom = Math.max(cur.bottom, r.bottom);
      cur.to = i;
    } else {
      bands.push({ top: r.top, bottom: r.bottom, from: i, to: i });
    }
  });
  return bands;
}

/**
 * Insertion index 0..rects.length for a pointer over a wrapping chip row.
 * `rects` are the boxes of the counted entries in zone order, WITHOUT the
 * dragged entry. Within a row, the midpoint of each chip decides: left of it
 * means before, right of it means after.
 */
export function computeDropIndex(rects: DropRect[], pointer: { x: number; y: number }): number {
  if (rects.length === 0) { return 0; }
  const bands = _bands(rects);
  if (pointer.y < bands[0].top) { return 0; }
  const last = bands[bands.length - 1];
  if (pointer.y >= last.bottom) { return rects.length; }
  // First row that ends below the pointer - in the gap between two rows this
  // is the lower one, which the pointer is heading toward.
  const band = bands.find((b) => pointer.y < b.bottom) ?? last;
  for (let i = band.from; i <= band.to; i++) {
    if (pointer.x < (rects[i].left + rects[i].right) / 2) { return i; }
  }
  return band.to + 1;
}

/**
 * Translates the index into what axis.ts needs: `beforeDim` for
 * `moveDimToZone` and `resting` - the index corresponds to the current position
 * of the dragged dimension in this zone, so releasing would have no effect.
 * `zoneDims` is the zone list INCLUDING the dragged dimension.
 */
export function resolveDropPlacement(
  zoneDims: string[], draggedDim: string, index: number,
): { beforeDim: string | null; resting: boolean } {
  const rest = zoneDims.filter((d) => d !== draggedDim);
  const at = Math.max(0, Math.min(index, rest.length));
  return { beforeDim: rest[at] ?? null, resting: zoneDims.indexOf(draggedDim) === at };
}
