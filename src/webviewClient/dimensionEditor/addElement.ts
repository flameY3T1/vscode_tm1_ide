/**
 * Shared "add element" flow for the Dimension Editor.
 *
 * Used by the toolbar "+ Element" button (root add) and the tree row
 * context-menu ("Add element" = root, "Add child element" = under the clicked
 * consolidation). Kept in its own module so both entry points share one
 * validated implementation without a tree<->dom import cycle.
 */

import { state } from './state';
import { findElement, updateDirty } from './helpers';
import { askInput, showError } from './modals';
import { renderTree } from './tree';
import { renderDetail } from './detail';
import { occKey, nextOrder } from './pure';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

/**
 * The chosen type comes back from the select field as a string. Anything
 * that is not C or S becomes N — so that a tampered or missing value
 * never puts an invalid element type into the draft.
 */
export function toElementType(raw: string | undefined): 'N' | 'C' | 'S' {
  return raw === 'C' || raw === 'S' ? raw : 'N';
}

/**
 * Prompt for a name and a type, then add the element. When `parentName` is
 * given the element is inserted as its child (parent is promoted to C if needed
 * and un-collapsed so the new row is visible); otherwise it is a root element.
 * The new occurrence becomes the selection.
 *
 * The type is selectable (N/C/S), default N. Previously it was hard-wired to
 * `'N'`: a consolidation came into being only as a side effect when a
 * child was attached beneath it, and a string element not at all.
 */
export async function promptAddElement(parentName: string | null): Promise<void> {
  if (!state.data) { return; }
  const r = await askInput({
    title: parentName ? L.newChildElementTitle : L.newElementTitle,
    fields: [
      { id: 'name', label: L.nameLabel, placeholder: L.elementNamePlaceholder },
      {
        id: 'type', label: L.elementTypeLabel, value: 'N',
        options: [
          { value: 'N', label: L.elementTypeNumeric },
          { value: 'C', label: L.elementTypeConsolidated },
          { value: 'S', label: L.elementTypeString },
        ],
      },
    ],
    okLabel: L.create,
  });
  if (!r) { return; }
  const trimmed = (r.name || '').trim();
  if (!trimmed) { showError(L.nameMustNotBeEmpty); return; }
  if (findElement(trimmed)) { showError(fmt(L, 'elementAlreadyExists', trimmed)); return; }
  if (/['[\]\x00-\x1f]/.test(trimmed)) { showError(L.invalidCharsElement); return; }

  const data = state.data;
  data.elements[trimmed] = { name: trimmed, type: toElementType(r.type), attrs: {}, marked: 'new' };

  let occParentName: string | null = null;
  if (parentName) {
    const parentEl = findElement(parentName);
    if (parentEl && parentEl.marked !== 'deleted') {
      if (parentEl.type !== 'C') {
        parentEl.type = 'C';
        if (parentEl.marked === 'clean') { parentEl.marked = 'changed'; }
      }
      data.edges.push({ parent: parentName, child: trimmed, weight: 1, marked: 'new', order: nextOrder(data.edges, parentName) });
      state.collapsed.delete(parentName); // reveal the new child
      occParentName = parentName;
    }
  }

  data.dirty = true;
  const key = occKey(occParentName, trimmed);
  state.selected = new Set([key]);
  state.anchor = key;
  renderTree(); renderDetail(); updateDirty();
}
