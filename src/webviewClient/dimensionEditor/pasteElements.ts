/**
 * Pasting the clipboard into the CURRENT hierarchy (Ctrl+V and the
 * entries in the row context menu).
 *
 * The calculation itself lives in `dimensionEditor/pasteStructurePure.ts` and is
 * unit-tested there; what remains here is applying it to the draft and the
 * feedback to the user.
 */
import { state } from './state';
import { updateDirty } from './helpers';
import { showInfo } from './modals';
import { renderTree } from './tree';
import { renderDetail } from './detail';
import { nextOrder } from './pure';
import { getL10n, fmt } from '../_shared/l10n';
import { planPaste, type PasteSkip } from '../../dimensionEditor/pasteStructurePure';

const L = getL10n();

/** Collects the skipped names by reason into a readable clause. */
function describeSkips(skipped: PasteSkip[]): string {
  const byReason = new Map<PasteSkip['reason'], string[]>();
  for (const s of skipped) {
    const l = byReason.get(s.reason);
    if (l) { l.push(s.name); } else { byReason.set(s.reason, [s.name]); }
  }
  const label: Record<PasteSkip['reason'], string> = {
    typeConflict: L.skipTypeConflict,
    cycle: L.skipCycle,
    alreadyChild: L.skipAlreadyChild,
  };
  return [...byReason.entries()]
    .map(([reason, names]) => `${names.join(', ')} (${label[reason]})`)
    .join('; ');
}

/**
 * Pastes the clipboard under `target`; `null` = top level.
 *
 * Elements that already exist in the target hierarchy are not created anew,
 * but only linked — measured live, TM1 answers adding an
 * existing element to a further hierarchy with 201, and a
 * differing type with 400 `ElementLeafTypeConflict`.
 */
export function pasteClipboard(target: string | null): void {
  const data = state.data;
  if (!data) { return; }
  const clip = state.clipboard;
  if (clip.elements.length === 0) { showInfo(L.clipboardEmpty); return; }

  // `data.elements` is a plain object in the webview, NOT a Map — the draft
  // travels as JSON through `postMessage`, and a Map does not survive that (see
  // `helpers.ts#elementsList`, which likewise takes `Object.values`). For the
  // pure calculation, convert it into a Map once; this runs only on paste.
  const plan = planPaste(clip, target, new Map(Object.entries(data.elements)), data.edges);

  for (const el of plan.addElements) {
    data.elements[el.name] = { name: el.name, type: el.type, attrs: {}, marked: 'new' };
  }
  for (const e of plan.addEdges) {
    data.edges.push({
      parent: e.parent, child: e.child, weight: e.weight,
      marked: 'new', order: nextOrder(data.edges, e.parent),
    });
  }

  if (plan.addElements.length || plan.addEdges.length) {
    // `updateDirty()` only READS `data.dirty` — the caller has to set it, as
    // every other mutation path here does. Without this line "Save" stayed
    // greyed out, and worse: switching the hierarchy did not warn and silently
    // discarded what was pasted.
    data.dirty = true;
    // A collapsed target would hide what was pasted — the user would take
    // that for nothing having happened.
    if (target) { state.collapsed.delete(target); }
    renderTree();
    renderDetail();
    updateDirty();
  }

  const n = plan.addElements.length + plan.addEdges.length;
  if (plan.skipped.length) {
    showInfo(fmt(L, 'pasteInsertedSkipped', n, describeSkips(plan.skipped)));
  } else if (n > 0) {
    showInfo(fmt(L, 'pasteInserted', plan.addElements.length, plan.addEdges.length));
  } else {
    showInfo(L.pasteNothingToDo);
  }
}
