/**
/**
 * Ctrl+V into the grid: pure wiring. Every decision lives in
 * `pasteGridPure.ts`; this file holds the event, guards, coordinates and the post.
 */

import { state } from './state';
import type { MatrixData } from './state';
import { showToast, focusIsInput } from './dom';
import { sendBulkCellWrite } from './bulkWrite';
import { parseClipboardGrid, planPaste, pastePositions } from './pasteGridPure';
import type { PastePlan, PasteCellRef } from './pasteGridPure';
import { getL10n, fmt } from '../_shared/l10n';
import { buildCoordinates } from '../../cubeViewer/cellWrite';
import { pickDefinitionForCell } from '../../cubeViewer/picklistPure';
import { getTitleAssignments, sendResolvePicklist } from './actions';
import { nextPicklistReqId } from './picklistReqSeq';
import { knownCellPicklistDef } from './cellPicklistCache';

const L = getL10n();

/**
 * Pending `resolvePicklist` round trips that THIS module itself triggered,
 * kept separate from the editor slot (`state.pendingPicklist`, editor.ts): a
 * paste can resolve several DISTINCT definitions at the same time, whereas
 * the inline editor only ever resolves exactly one. `messaging.ts` passes
 * every `picklistValues` response on to `resolvePastePicklistResponse`; a
 * `reqId` that matches no open entry here belongs to the editor path (or has
 * long been consumed) and is silently ignored.
 *
 * Cleanup: every entry carries (in `resolvePicklistAsync`) its own timeout,
 * which removes it after `PASTE_PICKLIST_TIMEOUT_MS` at the latest. If the
 * host never answers (the panel disappears in the middle of the round trip,
 * the host throws before answering), the entry would otherwise stay forever
 * and `applyPaste` would never finish (fix round 1, finding 7).
 */
const _pastePicklistResolvers = new Map<number, (values: string[] | null) => void>();

/**
 * Called by `messaging.ts` when a `picklistValues` response arrives. Returns
 * `true` if the response belonged to a paste in progress (it is then
 * consumed), otherwise `false`, so that the caller passes it on to the
 * editor path.
 */
export function resolvePastePicklistResponse(reqId: number, values: string[] | null): boolean {
  const resolve = _pastePicklistResolvers.get(reqId);
  if (!resolve) { return false; }
  _pastePicklistResolvers.delete(reqId);
  resolve(values);
  return true;
}

// Safety net against a response that never arrives (fix round 1, finding 7).
// After the timeout the same rule applies as for an unresolvable definition:
// `null`, so TM1 decides on write instead of leaving the paste hanging
// forever.
const PASTE_PICKLIST_TIMEOUT_MS = 15000;

function resolvePicklistAsync(def: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const reqId = nextPicklistReqId();
    const timer = setTimeout(() => {
      if (_pastePicklistResolvers.delete(reqId)) { resolve(null); }
    }, PASTE_PICKLIST_TIMEOUT_MS);
    _pastePicklistResolvers.set(reqId, (values) => {
      clearTimeout(timer);
      resolve(values);
    });
    sendResolvePicklist(def, reqId);
  });
}

/**
 * Resolves the DISTINCT picklist definitions in the paste area, once PER
 * DEFINITION, not per cell (the same definition can cover thousands of
 * cells). Returns `undefined` if not a single cell in the whole area carries
 * a definition: `planPaste` then behaves exactly as before task 12 and there
 * is NO round trip to the host. Picklist-free views must not get slower
 * because of this check.
 */
async function resolveAreaPicklists(
  grid: Array<Array<string | null>>,
  anchor: { ri: number; ci: number } | null,
  rowIndex: number[],
  colIndex: number[],
  m: MatrixData,
  selection: PasteCellRef[],
): Promise<Record<string, string[] | null> | undefined> {
  const positions = pastePositions(grid, anchor, rowIndex, colIndex, selection);
  if (!positions.length) { return undefined; }

  const cubeDims = state.dimensions || [];
  const rowDims = m.rowDims ?? [];
  const colDims = m.colDims ?? [];
  const rowTuples = m.rowTuples ?? [];
  const colTuples = m.colTuples ?? [];
  const byElement = m.picklistByElem ?? {};
  const byRuleElement = m.picklistByRuleElem ?? {};
  const titleAssignments = getTitleAssignments();

  // Collect the definition per cell, with the same precedence as for a single
  // edit (`resolvePicklistDefForCell`, editor.ts) and the bulk write path
  // (`sendBulkCellWrite`, bulkWrite.ts).
  //
  // Checking is done ONLY against KNOWN definitions: the attribute map, the
  // rule map and the cells that the lazy single query has already delivered.
  // This code expressly does NOT ask for cell definitions row by row, as that
  // would be the deleted area query in miniature (417 cells = 12.5 s
  // measured). Whatever remains unknown here is decided by TM1 on write; the
  // rejection is then explained by `picklistWriteError.ts`.
  const defByKey = new Map<string, string>();
  for (const { ri, ci } of positions) {
    try {
      const coordinates = buildCoordinates({
        cubeDims, rowDims, colDims, rowTuples, colTuples, ri, ci, titleAssignments,
      });
      const def = pickDefinitionForCell({
        cellDef: knownCellPicklistDef(coordinates) ?? undefined,
        coordinates, cubeDims, byElement, byRuleElement,
      });
      if (def) { defByKey.set(`${ri},${ci}`, def); }
    } catch {
      // Coordinates cannot be built (e.g. a title dimension without a
      // selection): the same silent fallback as `resolvePicklistDefForCell`,
      // with no list and no abort of the whole paste.
    }
  }
  if (!defByKey.size) { return undefined; }

  const distinctDefs = Array.from(new Set(defByKey.values()));
  const resolvedEntries = await Promise.all(
    distinctDefs.map(async (def): Promise<[string, string[] | null]> => [def, await resolvePicklistAsync(def)]),
  );
  const byDef = new Map(resolvedEntries);

  const picklistValues: Record<string, string[] | null> = {};
  for (const [key, def] of defByKey) {
    picklistValues[key] = byDef.get(def) ?? null;
  }
  return picklistValues;
}

/**
 * The selected cells as a list in RAW index space. `state.selection` holds
 * `"ri,ci"` keys (selection.ts). Broken keys are dropped instead of travelling
 * on as a `NaN` coordinate.
 */
function _selectedCells(): PasteCellRef[] {
  const sel = state.selection;
  if (!sel || sel.size === 0) { return []; }
  const cells: PasteCellRef[] = [];
  for (const k of sel) {
    const [ri, ci] = k.split(',').map(Number);
    if (Number.isFinite(ri) && Number.isFinite(ci) && ri >= 0 && ci >= 0) { cells.push({ ri, ci }); }
  }
  return cells;
}

function _refuse(plan: Extract<PastePlan, { ok: false }>): void {
  if (plan.reason === 'empty') { return; }
  if (plan.reason === 'no-anchor') { showToast(L.pasteNoAnchor, 'error'); return; }
  if (plan.reason === 'does-not-fit') {
    showToast(fmt(L, 'pasteDoesNotFit', plan.needRows, plan.needCols, plan.haveRows, plan.haveCols), 'error');
    return;
  }
  showToast(
    plan.why === 'consolidated' ? L.pasteBlockedConsolidated
      : plan.why === 'rule' ? L.pasteBlockedRule
        : L.pasteBlockedLocked,
    'error',
  );
}

export async function applyPaste(text: string): Promise<void> {
  const m = state.lastMatrix;
  if (!m) { return; }
  // A negative anchor would inflate `rowCount - anchor.ri` (planPaste) and
  // produce targets with negative coordinates, so treat it as "no anchor".
  const rawAnchor = state.selectionAnchor;
  const anchor = rawAnchor && rawAnchor.ri >= 0 && rawAnchor.ci >= 0 ? rawAnchor : null;
  const grid = parseClipboardGrid(text);
  // Freeze the visible order BEFORE the round trip (fix round 1, finding 4).
  // `planPaste` reads it twice below (pre-check + final plan), but ALWAYS the
  // same frozen references, never whatever `renderGrid` may have rebuilt in
  // the meantime.
  const rowIndex = state.renderedRowIdx;
  const colIndex = state.renderedColIdx;
  const cellFlags = m.cellFlags ?? {};
  const commaDecimal = state.numFmt.comma;
  // Also FREEZE the selected cells (same reasoning as for the visible
  // lists): a single copied value fills the whole selection, and that must
  // not change between the pre-check and the final plan.
  const selection = _selectedCells();

  // Cheap, purely synchronous refusals FIRST (fix round 1, finding 7):
  // fit and locked cells cost nothing and decide "all or nothing" anyway. A
  // paste that fails on them should not first send every picklist definition
  // in the area to the host and back, only for the result to be discarded.
  const preCheck = planPaste({ grid, anchor, rowIndex, colIndex, cellFlags, commaDecimal, selection });
  if (!preCheck.ok) { _refuse(preCheck); return; }

  // Resolve the picklist definitions of the area. The resolution itself is
  // a round trip to the host. `planPaste` receives the finished
  // `picklistValues` and stays synchronous.
  const picklistValues = await resolveAreaPicklists(grid, anchor, rowIndex, colIndex, m, selection);

  // The view stays usable during the round trip (the grid is not locked), so
  // it may have changed: a NEW matrix (refresh, pivot) OR a click-driven
  // redraw that keeps the same matrix but shifts the visible row/column list
  // (collapse triangle, localFocus, occurrence hiding, merged row side).
  // `renderGrid` (grid.ts) replaces `renderedRowIdx`/`renderedColIdx` on EVERY
  // call with a new copy (`.slice()`), even if the content is unchanged, so
  // the reference comparison is sufficient. Without this second half of the
  // guard, the `picklistValues` collected BEFORE the round trip would be
  // planned against a SHIFTED list: targets would land in cells the user
  // never selected, and their picklist check would run against the wrong
  // cell and could wrongly wave the value through (fix round 1, finding 4).
  // Discard instead of writing at stale coordinates, and tell the user that
  // nothing happened, instead of a Ctrl+V that silently has no effect.
  if (state.lastMatrix !== m
      || state.renderedRowIdx !== rowIndex
      || state.renderedColIdx !== colIndex) {
    showToast(L.pasteStaleView, 'error');
    return;
  }

  const plan = planPaste({
    grid, anchor, rowIndex, colIndex, cellFlags, commaDecimal, picklistValues, selection,
  });
  if (!plan.ok) { _refuse(plan); return; }

  // Kept separate from the actual write result (`pasteOk`/`spreadBulkError` in
  // `_onCellEditBulkResult`, messaging.ts): the user should be able to tell
  // "TM1 would have rejected this" from "the write failed".
  if (plan.rejectedByPicklist?.length) {
    showToast(fmt(L, 'pastePicklistRejected', plan.rejectedByPicklist.length), 'error');
  }
  if (!plan.targets.length) { return; }

  sendBulkCellWrite('paste', plan.targets);
}

export function wirePaste(): void {
  // The key path (`navigator.clipboard.readText()` on Ctrl+V) is
  // deliberately absent here: whether it is needed is currently being measured
  // live (result B from task 1). If the measurement turns out that way, it
  // will be added in a follow-up round.
  document.addEventListener('paste', (ev: ClipboardEvent) => {
    if (focusIsInput()) { return; }
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    if (!text) { return; }
    ev.preventDefault();
    void applyPaste(text);
  });
}
