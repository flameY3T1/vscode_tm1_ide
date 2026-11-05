/**
 * Delete/Backspace clears the selected cells - pure wiring. Every decision
 * lives in `clearCellsPure.ts`, writing goes through the shared path in
 * `bulkWrite.ts` (the same as Ctrl+V).
 *
 * Clearing is a write with the value `''` - exactly what pasting an empty
 * field already does. No separate host path needed.
 */

import { state } from './state';
import { showToast, focusIsInput } from './dom';
import { sendBulkCellWrite } from './bulkWrite';
import { planClear } from './clearCellsPure';
import type { ClearPlan } from './clearCellsPure';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

function _refuse(plan: Extract<ClearPlan, { ok: false }>): void {
  // 'empty': nothing selected or everything selected is already empty - both are
  // not an error, just nothing to do.
  if (plan.reason === 'empty') { return; }
  showToast(
    plan.why === 'consolidated' ? L.clearBlockedConsolidated :
    plan.why === 'rule'         ? L.clearBlockedRule :
                                  L.clearBlockedLocked,
    'error',
  );
}

export function applyClear(): void {
  const m = state.lastMatrix;
  if (!m) { return; }
  const sel = state.selection;
  if (!sel || sel.size === 0) { return; }

  const cells = [...sel].map((k) => {
    const [ri, ci] = k.split(',').map(Number);
    return { ri, ci };
  });

  const plan = planClear({
    cells,
    cellFlags: m.cellFlags ?? {},
    rawValues: m.rawValues ?? {},
    values: m.values ?? {},
  });
  if (!plan.ok) { _refuse(plan); return; }

  sendBulkCellWrite('clear', plan.targets.map((t) => ({ ri: t.ri, ci: t.ci, value: '' })));
}

export function wireClear(): void {
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') { return; }
    // Modifiers belong to other paths (Ctrl+Backspace = delete word in a
    // field, Alt+Left = back) - only the bare key clears.
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) { return; }
    // Input field/open cell editor: the key belongs there.
    if (focusIsInput()) { return; }
    if (!state.selection || state.selection.size === 0) { return; }
    ev.preventDefault();
    applyClear();
  });
}
