/**
 * Delete key in the grid — the entire decision logic, without DOM and without
 * `vscode` (`pure-no-vscode`, enforced by depcruise). `clear.ts` remains wiring.
 *
 * Clearing is a write with the value `''` — the same path `planPaste` takes for
 * a copied empty cell. This planner therefore only returns the coordinate
 * pairs; the caller sets the value.
 */

export interface ClearCell { ri: number; ci: number }

export type ClearPlan =
  | { ok: true; targets: ClearCell[] }
  /** Nothing selected OR everything selected is already empty — either way: do nothing, silently. */
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'blocked'; ri: number; ci: number; why: 'consolidated' | 'rule' | 'locked' };

export interface ClearInput {
  /** The selection, in any order (Ctrl-click collects in click order). */
  cells: ClearCell[];
  cellFlags: Record<string, { c?: 1; r?: 1; u?: 0; s?: 1 } | undefined>;
  /** Raw values (`state.lastMatrix.rawValues`) — authoritative for "is there anything in it". */
  rawValues: Record<string, string>;
  /** Display values as a fallback, as in the selection display (`selection.ts`). */
  values: Record<string, string>;
}

/**
 * What Delete would do over the selection — or why it does not happen.
 *
 * "All or nothing": if ONE non-writable cell lies in the selection, a rejection
 * is returned and the caller writes NOTHING. The block counts regardless of
 * whether the cell would have become a target at all — otherwise the rejection
 * would depend on the coincidence of whether a value happens to be there.
 * This check cannot anticipate server rejections (TM1 has no transactions),
 * just like with paste.
 */
export function planClear(input: ClearInput): ClearPlan {
  const { cellFlags, rawValues, values } = input;
  if (!input.cells.length) { return { ok: false, reason: 'empty' }; }

  // Fixed row/column order instead of click order: it determines both WHICH
  // blocking cell is reported and the write order in the host (which writes
  // sequentially and aborts on the first error). Neither may depend on the
  // order in which the user clicked.
  const cells = [...input.cells].sort((a, b) => (a.ri - b.ri) || (a.ci - b.ci));

  for (const { ri, ci } of cells) {
    const f = cellFlags[`${ri},${ci}`];
    if (f?.c === 1) { return { ok: false, reason: 'blocked', ri, ci, why: 'consolidated' }; }
    if (f?.r === 1) { return { ok: false, reason: 'blocked', ri, ci, why: 'rule' }; }
    if (f?.u === 0) { return { ok: false, reason: 'blocked', ri, ci, why: 'locked' }; }
  }

  // An already empty cell does not become a target: the host writes ONE POST
  // per target, and a rectangle over a sparsely populated view would otherwise
  // consist almost entirely of writes that change nothing.
  const targets = cells.filter(({ ri, ci }) => {
    const k = `${ri},${ci}`;
    return (rawValues[k] ?? values[k] ?? '') !== '';
  });
  if (!targets.length) { return { ok: false, reason: 'empty' }; }

  return { ok: true, targets: targets.map(({ ri, ci }) => ({ ri, ci })) };
}
