/**
 * The shared write path for multi-cell writes from the grid
 * (Ctrl+V and Delete): build coordinates, draw as pending, post `cellEditBulk`.
 *
 * Both paths share it because the marker protocol (`pastePending` +
 * `pendingOld`) that `_onCellEditBulkResult` (messaging.ts) relies on during
 * cleanup may exist in only ONE place - if it drifts apart, a marking stays
 * grey or an unrelated single edit gets swept along.
 */

import { state } from './state';
import { vscode } from './vscodeApi';
import { showToast } from './dom';
import { getTitleAssignments, wireTarget } from './actions';
import { buildCoordinates } from '../../cubeViewer/cellWrite';
import { pickDefinitionForCell } from '../../cubeViewer/picklistPure';
import { knownCellPicklistDef } from './cellPicklistCache';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

export type BulkKind = 'paste' | 'clear';

let _lastKind: BulkKind = 'paste';

/** Which path triggered the running balance. `_onCellEditBulkResult`
 *  (messaging.ts) afterwards reports "written" or "cleared" - the balance
 *  itself comes from the host and does not know the difference. */
export function lastBulkKind(): BulkKind { return _lastKind; }

export interface BulkCellTarget { ri: number; ci: number; value: number | string }

/**
 * Writes the targets as one balance. Posts NOTHING if a coordinate cannot be
 * formed (title dimension without a selection or similar) - that is a build
 * error in ALL targets alike (the same `titleAssignments`/`m.rowDims`/
 * `m.colDims` basis for every target), not a violation by ONE single cell;
 * the error has already been reported at that point.
 *
 * This is NOT the same "all or nothing" as for fit/locked cells in
 * `pasteGridPure.ts#planPaste` - there the rule is deliberately coarse,
 * because a partial paste would never tell the user about the missing cells.
 * A picklist rejection, on the other hand, has already been filtered out of
 * `targets` per cell BEFORE this call (`planPaste`'s `rejectedByPicklist`) -
 * what arrives here are only the valid targets, `sendBulkCellWrite` itself no
 * longer makes any value decision and posts them as one balance.
 */
export function sendBulkCellWrite(kind: BulkKind, cells: BulkCellTarget[]): void {
  const m = state.lastMatrix;
  if (!m || !cells.length) { return; }
  _lastKind = kind;

  const titleAssignments = getTitleAssignments();
  const cubeDims = state.dimensions || [];
  const byElement = m.picklistByElem ?? {};
  const byRuleElement = m.picklistByRuleElem ?? {};
  const targets: Array<{
    ri: number; ci: number; coordinates: string[]; value: number | string;
    picklistDef: string | null;
  }> = [];
  let dimensions: string[] = [];
  for (const t of cells) {
    try {
      const coordinates = buildCoordinates({
        cubeDims,
        rowDims: m.rowDims ?? [], colDims: m.colDims ?? [],
        rowTuples: m.rowTuples ?? [], colTuples: m.colTuples ?? [],
        ri: t.ri, ci: t.ci, titleAssignments,
      });
      const wire = wireTarget(t.ri, t.ci, coordinates);
      dimensions = wire.dimensions; // same layout for every cell
      targets.push({
        ri: t.ri, ci: t.ci, value: t.value, coordinates: wire.coordinates,
        // The same test as for the single edit (`resolvePicklistDefForCell` in
        // `editor.ts`) - PER TARGET, so that a rejected cell (e.g. on the
        // Delete path, for which no value pre-check can exist) gets the list
        // of ITS OWN cell, not that of the first one in the batch.
        picklistDef: pickDefinitionForCell({
          cellDef: knownCellPicklistDef(coordinates) ?? undefined,
          coordinates, cubeDims, byElement, byRuleElement,
        }),
      });
    } catch (err) {
      showToast(fmt(L, 'errorPrefix', (err as Error)?.message ?? String(err)), 'error');
      return;
    }
  }

  // Draw as pending; resolution happens not per cell but through the refresh
  // the host triggers after the balance. `pendingOld` remembers the previous
  // text like `commitEdit` (editor.ts) - if the whole balance fails, the
  // refresh does not happen (`if (okCount > 0)` in the host), and
  // `_onCellEditBulkResult` needs the old text so as not to leave the marking
  // grey permanently.
  for (const t of targets) {
    const td = document.querySelector<HTMLTableCellElement>(`td[data-ri="${t.ri}"][data-ci="${t.ci}"]`);
    if (td) {
      td.dataset.pendingOld = td.textContent ?? '';
      // A separate marker, because single-cell edits (`commitEdit`, editor.ts)
      // use the same class `cell-pending` AND the same `pendingOld` - without
      // this marker the cleanup sweep would sweep along unrelated single edits
      // that are currently in flight.
      td.dataset.pastePending = '1';
      td.textContent = String(t.value);
      td.className = `${td.className} cell-pending`.trim();
    }
  }

  vscode.postMessage({
    type: 'cellEditBulk',
    dimensions,
    targets,
  });
}
