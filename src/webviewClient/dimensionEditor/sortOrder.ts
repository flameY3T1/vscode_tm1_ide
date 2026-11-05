/**
 * "Sort order…" — shows the hierarchy's four sort properties as two dropdowns
 * instead of free-text control-cube cells.
 *
 * Opening asks the host for the stored values (`readSortOrder`); the answer
 * (`sortOrderState`) opens the dialog. Saving runs `HierarchySortOrder` on the
 * host, which then reloads the editor, because the sort rewrites the element
 * order on the server.
 */
import type { ComponentSort, ElementSort, SortOrderState } from '../../dimensionEditor/model';
import type { HostToWebview } from './protocol';
import { state, vscode } from './state';
import { askConfirm, askInput, showError, showInfo } from './modals';
import { renderAll } from './render';
import { getL10n, fmt } from '../_shared/l10n';
import { asNameMap } from '../../utils/nameMapPure';

const L = getL10n();

const ELEMENT_OPTIONS: Array<{ value: ElementSort; label: string }> = [
  { value: 'input', label: L.sortInput },
  { value: 'name-asc', label: L.sortNameAsc },
  { value: 'name-desc', label: L.sortNameDesc },
  { value: 'level-asc', label: L.sortLevelAsc },
  { value: 'level-desc', label: L.sortLevelDesc },
  { value: 'hierarchy', label: L.sortHierarchy },
];
const COMPONENT_OPTIONS: Array<{ value: ComponentSort; label: string }> = [
  { value: 'input', label: L.sortInput },
  { value: 'name-asc', label: L.sortNameAsc },
  { value: 'name-desc', label: L.sortNameDesc },
];

/** `hier` from the tree entry; the toolbar button uses the shown hierarchy. */
export function requestSortOrder(hier?: string): void {
  if (!state.data) { return; }
  if (state.data.dirty) { showError(L.sortBlockedDirty); return; }
  vscode.postMessage({ type: 'readSortOrder', hier: hier ?? state.data.hierName });
}

export async function handleSortOrderState(msg: Extract<HostToWebview, { type: 'sortOrderState' }>): Promise<void> {
  if (!msg.sort) { showError(fmt(L, 'sortReadFailed', msg.message ?? '')); return; }
  const res = await askInput({
    title: fmt(L, 'sortDialogTitle', msg.hier),
    okLabel: L.sortApply,
    fields: [
      { id: 'elements', label: L.sortElementsLabel, value: msg.sort.elements, options: ELEMENT_OPTIONS },
      { id: 'components', label: L.sortComponentsLabel, value: msg.sort.components, options: COMPONENT_OPTIONS },
    ],
  });
  if (!res) { return; }
  const sort: SortOrderState = {
    elements: res.elements as ElementSort,
    components: res.components as ComponentSort,
  };
  if (sort.elements === msg.sort.elements && sort.components === msg.sort.components) { return; }
  // The draft stays editable while the read and the dialog are open.
  if (state.data?.dirty) { showError(L.sortBlockedDirty); return; }
  vscode.postMessage({ type: 'setSortOrder', hier: msg.hier, sort });
}

export async function handleSortOrderResult(msg: Extract<HostToWebview, { type: 'sortOrderResult' }>): Promise<void> {
  if (!msg.ok) { showError(msg.message ?? ''); return; }
  showInfo(L.sortSaved);
  if (!msg.state) { return; }
  // Edited while the sort ran: never replace that draft without asking.
  if (state.data?.dirty && !(await askConfirm({ message: L.discardConfirm, yes: L.discardYes, danger: true }))) { return; }
  state.data = msg.state;
  if (state.data?.elements) { asNameMap(state.data.elements); }
  renderAll();
}
