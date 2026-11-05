/**
 * Hierarchy switch logic (local apply after lazy fetch).
 *
 * Extracted from `index.ts` in Post-H17 #4 split.
 */

import { state } from './state';
import { renderAll } from './render';
import { asNameMap } from '../../utils/nameMapPure';

export {};

export function switchToHierLocal(newHier: string, preserveDirty: boolean): void {
  if (!state.data) return;
  const isKnownOnServer = !!(state.data.snapshot && state.data.snapshot.perHier && state.data.snapshot.perHier[newHier]);
  const content = isKnownOnServer
    ? state.data.snapshot.perHier[newHier]
    : { elements: [], edges: [], attrDefs: [] };
  state.data.hierName = newHier;
  state.data.elements = asNameMap(Object.fromEntries((content.elements || []).map((e) => [e.name, Object.assign({}, e)])));
  state.data.edges = (content.edges || []).map((e) => Object.assign({}, e));
  state.data.attrDefs = (content.attrDefs || []).map((a) => Object.assign({}, a));
  if (!preserveDirty) state.data.dirty = false;
  state.selected = new Set<string>();
  state.anchor = null;
  renderAll();
}
