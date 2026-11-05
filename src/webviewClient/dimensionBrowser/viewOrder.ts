/** Manual-order edits of the running view: append, pick parent, insert and move names. */

import { pushIntent, freezeOrder } from './intents';
import { flashBanner } from './banner';
import { getL10n, fmt } from '../_shared/l10n';
import { vr } from './viewRun';
import { fetchRows } from './viewFetch';
import { rowsComplete } from './viewQuery';
import { freshAnswer } from './viewActions';

const L = getL10n();

/**
 * Up to how many rows moving and inserting are allowed.
 *
 * Both write a MANUAL ORDER, and that is an enumerated expression:
 * every name individually. Measured live (11.8, 2026-08-24, large dimension,
 * mean name length 13 characters) - about 65 bytes and 43 us per element:
 *
 *    1,000 →  64 KB,   24 ms
 *    5,000 → 320 KB,  133 ms   (matches the older measurement: 134 ms)
 *   10,000 → 639 KB,  276 ms
 *   20,000 → 1.3 MB,  566 ms
 *   50,000 → 3.2 MB, 1430 ms
 *  100,000 → 6.6 MB, 4327 ms
 *
 * Linear, no knee - the cap is a reasonableness limit, not a
 * technical one. 20,000 is the instruction (flameY3T1, 2026-08-24). To keep in mind when
 * moving this number: the same expression is re-evaluated on EVERY follow-up
 * operation, goes through `postMessage` and appears in the MDX bar.
 *
 * The other way - moving as a positional intent instead of as a list
 * (`SUBSET` splice) - was measured and rejected: it can do occurrence semantics,
 * but the expression quadruples with each move (on 1.6 million rows:
 * 0.8 s / 2.9 s / 11 s / 47 s / 182 s for 1 to 5 moves).
 */
export const MOVE_CAP = 20_000;

/**
 * APPEND names to the set - the click path of Ctrl+V.
 *
 * The only intent that enlarges. Repetitions are explicitly
 * allowed: the same element may be added a second time.
 */
export function addNames(nameList: readonly string[]): void {
  if (!vr.run || !nameList.length) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = pushIntent(vr.run.view, { kind: 'add', names: nameList.slice() });
  vr.run.appended = nameList.slice();
  fetchRows();
}

/**
 * Set the CHOSEN parent above its occurrence.
 *
 * `at` is the position of the clicked row in `rows`. That is at the same time the
 * position in the server set: `rows` grows as a PREFIX (`rows.concat`), and
 * a clicked row is by definition loaded - its index is therefore
 * absolute, even if the set has not fully arrived yet.
 *
 * No `insertNamesAt`: that freezes the visible order into a
 * manual order (`freezeOrder`), needs a completely loaded
 * window and runs into `MOVE_CAP`. Here it stays an EXPRESSION - at every
 * dimension size and in every saved subset.
 */
export function pickParentAt(parent: string, at: number): void {
  if (!vr.run) { return; }
  const p = (parent || '').trim();
  if (!p) { return; }
  // Outside the set: the server silently appends at the END when `k` is too large
  // (measured live) - exactly the mistake this intent fixes. Better
  // to do nothing than to show it in the wrong place.
  if (!Number.isInteger(at) || at < 0 || at > vr.rows.length) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = pushIntent(vr.run.view, { kind: 'pick-parent', parent: p, at });
  vr.run.appended = [p];
  fetchRows();
}

/**
 * Insert names at a position - "insert above/below".
 *
 * A manual position only survives in a MANUAL ORDER: in the tree
 * the hierarchy determines where something stands, and the insertion would be invisible
 * (the same lesson as in the old path). That is why the visible order is
 * written down together with the insertion.
 *
 * That works ONLY with a completely loaded window: the manual order would have to
 * name the whole set, and turning a window into one would mean silently
 * deleting the rest.
 */
export function insertNamesAt(targetName: string, below: boolean, nameList: readonly string[]): void {
  if (!vr.run || !nameList.length) { return; }
  if (!rowsComplete()) { flashBanner(L.vwInsertWindowIncomplete ?? ''); return; }
  // Two different reasons, two different messages: above, rows are missing,
  // here there are too many. A shared text ("please filter") would make the
  // user guess WHY - and with 50,000 completely loaded rows
  // "the whole set must be loaded" would simply be wrong.
  if (vr.rows.length > MOVE_CAP) { flashBanner(fmt(L, 'vwMoveTooManyRows', MOVE_CAP.toLocaleString())); return; }
  const visibleNames = vr.rows.map((r) => r.name);
  const targetIdx = visibleNames.indexOf(targetName);
  // No target row, no position - then "above" is not stated.
  if (targetIdx < 0) { return; }
  const insertAt = below ? targetIdx + 1 : targetIdx;
  const newOrder = visibleNames.slice(0, insertAt).concat(nameList, visibleNames.slice(insertAt));
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = freezeOrder(vr.run.view, newOrder);
  freshAnswer();
  fetchRows();
}

/**
 * MOVE rows to another place - drag and drop.
 *
 * The same thing as "insert above/below", only with a handle instead of
 * the clipboard: a manual order, written down as an `explicit` base.
 * Move and not copy - the names drop out at their old place.
 *
 * The same reservation as there: ONLY with a completely loaded window. The
 * manual order would have to name the whole set, and turning a window into one
 * would mean silently deleting the rest.
 */
export function moveNamesTo(targetName: string, below: boolean, nameList: readonly string[]): void {
  if (!vr.run || !nameList.length) { return; }
  // Dropping onto itself is not a movement.
  if (nameList.length === 1 && nameList[0] === targetName) { return; }
  if (!rowsComplete()) { flashBanner(L.vwInsertWindowIncomplete ?? ''); return; }
  // Two different reasons, two different messages: above, rows are missing,
  // here there are too many. A shared text ("please filter") would make the
  // user guess WHY - and with 50,000 completely loaded rows
  // "the whole set must be loaded" would simply be wrong.
  if (vr.rows.length > MOVE_CAP) { flashBanner(fmt(L, 'vwMoveTooManyRows', MOVE_CAP.toLocaleString())); return; }
  const visibleNames = vr.rows.map((r) => r.name);
  if (visibleNames.indexOf(targetName) < 0) { return; }
  const toMove = new Set(nameList);
  // First take away, THEN look for the target place: after taking away it is
  // a different one, and computing against the old one would shift by the number of rows
  // that lay before the target.
  const remaining = visibleNames.filter((n) => !toMove.has(n));
  const targetIdx = remaining.indexOf(targetName);
  if (targetIdx < 0) { return; }
  const insertAt = below ? targetIdx + 1 : targetIdx;
  // `nameList` in THEIR order, not in the visible one: a block was
  // dragged, and it keeps its inner sequence.
  const newOrder = remaining.slice(0, insertAt).concat(nameList, remaining.slice(insertAt));
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = freezeOrder(vr.run.view, newOrder);
  freshAnswer();
  fetchRows();
}

/**
 * Make a name list the base - the load path of a STATIC subset.
 *
 * `freezeOrder` keeps the order in which the names arrive: a
 * static subset has a sequence chosen by the author, and reordering it
 * would mean discarding their decision.
 */
export function setNamesBase(names: readonly string[]): void {
  if (!vr.run) { return; }
  vr.run.previousView = vr.run.view;
  vr.run.preview = null;
  vr.run.view = freezeOrder(vr.run.view, names);
  freshAnswer();
  fetchRows();
}
