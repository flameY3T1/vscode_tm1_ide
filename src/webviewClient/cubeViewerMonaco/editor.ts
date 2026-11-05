/**
 * Inline cell editor + Ctrl-Z undo handler.
 *
 * Owns the `_activeEditor` singleton (only one cell may edit at a time) and
 * coordinates the optimistic-UI / blur-race / spread-auto-route logic that
 * the inline-template version had. Behavior must stay equivalent — the
 * extension's cellEdit / spread message handlers expect the same payload.
 */

import { state } from './state';
import { getRefs, refreshTdClassByValue, showToast } from './dom';
import { getL10n, fmt } from '../_shared/l10n';
import {
  buildCoordinates, parseEditedValue, parseStringCellValue, parseSpreadToken, pickDefinitionForCell, undoStack,
} from './pureBridge';
import { buildPicklistOptions } from './picklistOptionsPure';
import {
  sendCellEdit, sendResolvePicklist, sendFetchCellPicklist, sendSpread, getTitleAssignments,
} from './actions';
import { nextPicklistReqId } from './picklistReqSeq';
import { knownCellPicklistDef, rememberCellPicklistDef } from './cellPicklistCache';

const L = getL10n();

interface ActiveEditor {
  td: HTMLTableCellElement;
  /** null while `pending` — the round trip to resolve the picklist values is
   *  still in flight, so there is no control in the DOM yet. */
  input: HTMLInputElement | HTMLSelectElement | null;
  ri: number;
  ci: number;
  oldText: string;
  oldClass: string;
  /** The value the input was seeded with (raw full-precision) — commit compares
   *  against this so blurring an untouched cell never triggers a write. */
  initialVal: string;
  /** True while waiting for `resolvePicklist`'s answer. */
  pending?: boolean;
}

let activeEditor: ActiveEditor | null = null;

/**
 * The coordinates of a cell, or `null` if they cannot be built
 * (e.g. a title dimension without a selection). A build failure is not a user error
 * here but simply means "no dropdown" — the same silent fallback as in
 * `hasPicklist`.
 */
function coordinatesForCell(ri: number, ci: number): string[] | null {
  const m = state.lastMatrix;
  if (!m) return null;
  try {
    return buildCoordinates({
      cubeDims: state.dimensions || [],
      rowDims: m.rowDims ?? [],
      colDims: m.colDims ?? [],
      rowTuples: m.rowTuples ?? [],
      colTuples: m.colTuples ?? [],
      ri, ci,
      titleAssignments: getTitleAssignments(),
    });
  } catch {
    return null;
  }
}

/**
 * Determines the raw picklist definition for a cell from what is KNOWN:
 * the attribute map, the rule map and whatever the lazy single-cell lookup has already
 * delivered for exactly this coordinate. Resolves NOTHING itself — the
 * round trip to the host lives in `startEdit`.
 */
function resolvePicklistDefForCell(ri: number, ci: number): string | null {
  const m = state.lastMatrix;
  if (!m) return null;
  const coordinates = coordinatesForCell(ri, ci);
  if (!coordinates) return null;
  return pickDefinitionForCell({
    cellDef: knownCellPicklistDef(coordinates) ?? undefined,
    coordinates,
    cubeDims: state.dimensions || [],
    byElement: m.picklistByElem ?? {},
    byRuleElement: m.picklistByRuleElem ?? {},
  });
}

/** Builds the normal free-text `<input>` — the original (and still the
 *  default) editing path. Also the fallback when a cell carries the arrow
 *  but `resolvePicklist` replies with `values: null`. */
function openFreeTextInput(
  td: HTMLTableCellElement, ri: number, ci: number, oldText: string, oldClass: string,
): void {
  td.className = oldClass + ' editing';
  const input = document.createElement('input');
  input.type = 'text';
  // Edit the real full-precision value, not the rounded/reformatted display —
  // so what the user edits and writes back is the actual cell value.
  const rawVal = state.lastMatrix?.rawValues?.[`${ri},${ci}`];
  input.value = rawVal ?? oldText;
  // size=1 kills the input's default ~20-char intrinsic width; CSS (.editing input)
  // then fills exactly the cell, so entering edit mode never widens the column.
  input.size = 1;
  // Align input matching the cell type — strings are left-aligned, numerics right.
  input.style.textAlign = td.classList.contains('cell-string') || td.dataset.str === '1' ? 'left' : 'right';
  td.innerHTML = '';
  td.appendChild(input);
  input.focus();
  input.select();
  activeEditor = { td, input, ri, ci, oldText, oldClass, initialVal: input.value };

  input.onkeydown = (ev) => {
    if (ev.key === 'Enter')      { ev.preventDefault(); commitEdit(); }
    else if (ev.key === 'Escape'){ ev.preventDefault(); cancelEdit(); }
  };
  input.onblur = () => { commitEdit(); };
}

/** Builds the `<select>` for a resolved picklist. Committing goes through
 *  the same `commitEdit` path as the free-text editor (including the `initialVal`
 *  comparison — a selection without a change does not write). */
function openSelectInput(
  td: HTMLTableCellElement, ri: number, ci: number, oldText: string, oldClass: string,
  values: string[],
): void {
  td.className = oldClass + ' editing';
  // Trimmed, because buildPicklistOptions trims the old value internally in order to
  // compare it against the list — untrimmed, `select.value` below could
  // match no option and the browser would silently fall back to the first
  // option (exactly the silent value change that is forbidden).
  const rawVal = (state.lastMatrix?.rawValues?.[`${ri},${ci}`] ?? oldText).trim();
  const options = buildPicklistOptions(values, rawVal, (v) => fmt(L, 'picklistForeignValue', v));
  const select = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    select.appendChild(o);
  }
  // The old value is always present as an option (regular, or as a marked
  // foreign value from buildPicklistOptions) — preselecting therefore never changes
  // the cell value silently.
  select.value = rawVal;
  td.innerHTML = '';
  td.appendChild(select);
  select.focus();
  activeEditor = { td, input: select, ri, ci, oldText, oldClass, initialVal: rawVal };

  // Chromium fires `change` on a focused, CLOSED `<select>` for every key that
  // moves or jumps the selection — not just arrow/paging keys, also type-ahead
  // letters/digits and (outside macOS) ArrowLeft/ArrowRight. An allowlist of
  // "these keys count as browsing" keeps being wrong on the next key/platform
  // (Fix round 1 already missed type-ahead and ArrowLeft/Right this way).
  // Inverted instead (Fix round 2): `change` only commits when armed by an
  // explicit mouse pick. `mousedown` arms it; ANY keydown other than the two
  // that end the edit on their own (Enter commits directly, Escape cancels)
  // disarms it again — so no enumeration, and it stays correct for whatever
  // key Chromium decides to act on next. Tab needs no special case: it blurs,
  // and blur already commits.
  let armedByMouse = false;
  select.onmousedown = () => { armedByMouse = true; };
  select.onkeydown = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); return; }
    if (ev.key === 'Enter')  { ev.preventDefault(); commitEdit(); return; }
    armedByMouse = false;
  };
  select.onchange = () => { if (armedByMouse) commitEdit(); };
  select.onblur = () => { commitEdit(); };
}

export function startEdit(td: HTMLTableCellElement): void {
  if (activeEditor) return;
  const ri = Number(td.dataset.ri);
  const ci = Number(td.dataset.ci);
  if (Number.isNaN(ri) || Number.isNaN(ci)) return;
  if (!state.lastMatrix) return;
  if (td.classList.contains('cell-security')) return;
  if (td.classList.contains('cell-rule')) {
    showToast(L.ruleCellNotWritable, 'error');
    return;
  }
  if (td.classList.contains('cell-locked')) {
    showToast(L.cellNotWritable, 'error');
    return;
  }

  const oldText = td.textContent ?? '';
  const oldClass = td.className;

  // Consolidated cells take NO picklist — there `commitEdit` writes
  // a spread over the leaves below, and a single list value would have
  // no addressee. They stay editable (hence no `return` as with
  // rule/locked), they just go straight to the free-text field. The same rule
  // keeps `grid.ts` from showing the selection arrow (`gridPure#cellTakesPicklist`).
  const consolidated = td.classList.contains('cell-consolidated');

  // Stage A: the definition is KNOWN (attribute map, rule map or a cell
  // fetched individually earlier) — fetch the values directly.
  const def = consolidated ? null : resolvePicklistDefForCell(ri, ci);
  if (def) {
    markPending(td, ri, ci, oldText, oldClass);
    // Own counter (`picklistReqSeq.ts`), NOT `state._reqSent`/`nextReqId`
    // (Fix round 1, Finding 1) — the latter counts the refresh generation, against which
    // `messaging.ts#isCurrentResponse` checks incoming `cellData`/`error`;
    // a picklist round trip that advances it would make a running
    // refresh reply stale. Shared with `paste.ts` (Task 12):
    // a paste can have several `resolvePicklist` round trips open
    // at the same time, and a separate local counter here could draw the same reqId
    // as a paste round trip — both report back through the same
    // `picklistValues` reply (`messaging.ts`).
    const reqId = nextPicklistReqId();
    state.pendingPicklist = { ri, ci, reqId };
    sendResolvePicklist(def, reqId);
    return;
  }

  // Stage B: none of the area-wide maps knows this cell. Ask the host for exactly ONE cell
  // (measured 1–2 ms). Why not for the whole grid right on open:
  // 417 cells in one cellset cost 12.5 s, the window of a real saved
  // view ran for over ten minutes and had to be aborted on the
  // server — for a single cell with a picklist.
  //
  // It is only asked when there is anything to find at all: without
  // `}PickList_<Cube>` (`picklistCubePresent`) and for a coordinate that
  // has already answered `null` once, it goes straight to the
  // free-text field without a round trip — editing must not have to wait for the host.
  const coordinates = coordinatesForCell(ri, ci);
  if (!consolidated && state.lastMatrix?.picklistCubePresent && coordinates
      && knownCellPicklistDef(coordinates) === undefined) {
    markPending(td, ri, ci, oldText, oldClass);
    const reqId = nextPicklistReqId();
    state.pendingCellPicklist = { ri, ci, reqId, coordinates };
    sendFetchCellPicklist(coordinates, reqId);
    return;
  }

  openFreeTextInput(td, ri, ci, oldText, oldClass);
}

/**
 * Lock the cell until the reply arrives — the guard line in `startEdit`
 * (`if (activeEditor) return`) prevents a second double-click
 * during the round trip from opening a second editor.
 *
 * `cell-picklist-pending` (Fix round 1, Minor 1) is a CSS-only cursor/dim
 * hint — there is no control to show yet, so without it a double-click here
 * looks like it did nothing until the round trip resolves.
 */
function markPending(
  td: HTMLTableCellElement, ri: number, ci: number, oldText: string, oldClass: string,
): void {
  td.className = oldClass + ' editing cell-picklist-pending';
  activeEditor = { td, input: null, ri, ci, oldText, oldClass, initialVal: oldText, pending: true };
}

/**
 * Receiver-side handling of the `cellPicklistDef` reply (stage B). The same
 * two guards as in `applyPicklistValues`: `reqId` (checked by the caller in
 * `messaging.ts`) plus the still-open, still CONNECTED editor of the same
 * cell — see the detailed rationale there.
 *
 * `def === null` means "this cell has no picklist", NOT "empty list":
 * it goes to the free-text field, never to an empty selection field.
 */
export function applyCellPicklistDef(def: string | null): void {
  const pending = state.pendingCellPicklist;
  state.pendingCellPicklist = null;
  if (!pending || !activeEditor || !activeEditor.pending
      || activeEditor.ri !== pending.ri || activeEditor.ci !== pending.ci) {
    return;
  }
  // Even a discarded reply is valid information about THIS
  // coordinate — remember it, so the next double-click does not ask again.
  rememberCellPicklistDef(pending.coordinates, def);
  const { td, ri, ci, oldText, oldClass } = activeEditor;
  if (!td.isConnected) {
    // A re-render (click-driven) replaced this `<td>` during the round trip
    // — nothing to paint into, just release the dangling editor, so that
    // the NEXT `startEdit` does not get stuck on `if (activeEditor) return`.
    activeEditor = null;
    return;
  }
  if (def === null) {
    openFreeTextInput(td, ri, ci, oldText, oldClass);
    return;
  }
  // Catch up on stage A: now the values for this definition.
  const reqId = nextPicklistReqId();
  state.pendingPicklist = { ri, ci, reqId };
  sendResolvePicklist(def, reqId);
}

/**
 * Receiver-side handling of the `picklistValues` reply. The caller
 * (`messaging.ts`) has already checked `reqId` against `state.pendingPicklist`;
 * here a second, independent check against the currently open
 * editor is added (cell coordinate AND `pending` flag) — if `activeEditor`
 * had meanwhile been nulled or pointed to a different cell without
 * `pendingPicklist` being cleared, the reply still does not land
 * in the wrong or a vanished cell.
 *
 * The (ri,ci) comparison alone is not enough, though: `pending.ri/ci` come
 * from exactly the same `activeEditor` object that sent the request —
 * they can never differ from each other as long as `activeEditor`
 * stays the same. The actual break is a CLICK-driven
 * re-render (collapse triangle, context menu) that calls `renderGrid` without
 * going through `messaging.ts` — nothing was focused, so no
 * `blur` fires, `activeEditor` survives and points to a `<td>` that is no longer
 * in the document. Hence `td.isConnected` is checked in addition: only that
 * distinguishes "same cell" from "a cell that no longer exists".
 */
export function applyPicklistValues(values: string[] | null): void {
  const pending = state.pendingPicklist;
  state.pendingPicklist = null;
  if (!pending || !activeEditor || !activeEditor.pending
      || activeEditor.ri !== pending.ri || activeEditor.ci !== pending.ci) {
    return;
  }
  const { td, ri, ci, oldText, oldClass } = activeEditor;
  if (!td.isConnected) {
    // Re-render (click-driven, e.g. collapse triangle / context menu) already
    // replaced this `<td>` while the round trip was in flight. Nothing to
    // paint into and nothing to restore — just clear the dangling editor so
    // the NEXT `startEdit` is not wedged by `if (activeEditor) return`.
    activeEditor = null;
    return;
  }
  if (values === null) {
    // TM1 allows any value here (unreadable definition or dead
    // reference) — remove the arrow, otherwise the display keeps promising a
    // dropdown that does not exist, then the normal free-text fallback.
    td.classList.remove('cell-picklist');
    openFreeTextInput(td, ri, ci, oldText, oldClass.replace(/\s*\bcell-picklist\b/, '').trim());
    return;
  }
  openSelectInput(td, ri, ci, oldText, oldClass, values);
}

/**
 * Registered into `pendingEditGuard.ts` from `messaging.ts` and invoked from
 * `grid.ts#renderGrid` (single choke point, covers click-driven re-renders
 * too — see `applyPicklistValues`'s `td.isConnected` comment for the failure
 * this closes). Only ever cancels a PENDING picklist round trip: a normal
 * free-text or already-resolved `<select>` editor has a focused control, so
 * a click elsewhere blurs it and `commitEdit`/`cancelEdit` already ran before
 * `renderGrid` starts — nulling it here too would be redundant, not wrong,
 * but the pending case (no control, no focus, no blur) is the one that
 * actually needs this.
 */
export function cancelPendingPicklistEditor(): void {
  if (activeEditor?.pending) cancelEdit();
}

export function cancelEdit(): void {
  if (!activeEditor) return;
  const { td, oldText, oldClass } = activeEditor;
  // Null BEFORE any DOM mutation to prevent blur re-entry double-commit.
  activeEditor = null;
  // A pending picklist reply belongs to no editor from here on —
  // otherwise applyPicklistValues/applyCellPicklistDef would later check it against an
  // activeEditor that long since refers to another (or no) cell.
  // BOTH stages: the single-cell lookup is the precursor of the values lookup,
  // so an abort in the middle must not leave either of them open.
  state.pendingPicklist = null;
  state.pendingCellPicklist = null;
  td.className = oldClass;
  td.innerHTML = '';
  td.textContent = oldText;
}

export function commitEdit(): void {
  if (!activeEditor || !activeEditor.input) return;
  const { td, input, ri, ci, oldText, oldClass, initialVal } = activeEditor;
  const raw = input.value;

  // Untouched cell (blur/Enter without editing) must never write. Compare against
  // the seeded raw value — not the display — so seeding the input with full
  // precision does not read as a change (which would try to write and fail on a
  // consolidated cell with CubeCellWriteStatusElementIsConsolidated).
  if (raw.trim() === initialVal.trim()) { cancelEdit(); return; }

  // Auto-route: on consolidated cells (not rule/locked) with a recognised Architect
  // spread token, dispatch 'spread' instead of 'cellEdit'. Falls back to normal path.
  const flagMap = state.lastMatrix?.cellFlags;
  const cellFlag = flagMap ? flagMap[`${ri},${ci}`] : undefined;
  const isRule   = cellFlag?.r === 1;
  const isLocked = cellFlag?.u === 0;
  const isC      = cellFlag?.c === 1;
  if (isC && !isRule && !isLocked) {
    const sp = parseSpreadToken(raw);
    if (sp) {
      activeEditor = null;
      td.className = oldClass;
      td.innerHTML = '';
      td.textContent = oldText; // restore until view-refresh arrives
      sendSpread(sp.method, sp.value, ri, ci);
      return;
    }
  }

  const parsed = cellFlag?.s === 1 ? parseStringCellValue(raw) : parseEditedValue(raw);

  let coordinates: string[];
  try {
    const m = state.lastMatrix!;
    coordinates = buildCoordinates({
      cubeDims: state.dimensions || [],
      rowDims: m.rowDims ?? [],
      colDims: m.colDims ?? [],
      rowTuples: m.rowTuples ?? [],
      colTuples: m.colTuples ?? [],
      ri, ci,
      titleAssignments: getTitleAssignments(),
    });
  } catch (err) {
    showToast(fmt(L, 'errorPrefix', (err as Error)?.message ?? String(err)), 'error');
    cancelEdit();
    return;
  }

  // Null BEFORE any DOM mutation to prevent blur re-entry double-commit.
  activeEditor = null;

  td.className = oldClass + ' cell-pending';
  td.innerHTML = '';
  td.textContent = raw.trim();

  const sendValue: number | string =
    parsed.kind === 'numeric' ? parsed.payload :
    parsed.kind === 'empty'   ? '' :
                                parsed.payload;

  td.dataset.pendingOld = oldText;
  td.dataset.pendingNew = raw.trim();
  td.dataset.pendingCoords = JSON.stringify(coordinates);

  // The same test as the arrow (`hasPicklist` in `gridPure.ts`) — the host
  // uses the raw definition to interpret TM1's meaningless 285 error as a
  // picklist violation and to include the permitted values in the message
  // (`classifyWriteError`/`describePicklistRejection`).
  sendCellEdit({ ri, ci, value: sendValue, coordinates, picklistDef: resolvePicklistDefForCell(ri, ci) });
}

/** Wire dblclick on the grid container (delegated). */
export function wireGridDblClick(): void {
  const r = getRefs();
  r.gridContainer.addEventListener('dblclick', (ev: MouseEvent) => {
    const tgt = ev.target as Element | null;
    const td = tgt?.closest<HTMLTableCellElement>('td[data-ri]');
    if (td) startEdit(td);
  });
}

/** Wire Ctrl-Z / Cmd-Z for cell-undo. */
export function wireUndoShortcut(): void {
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    // Escape during a pending resolvePicklist round trip: there is not yet
    // any `<input>`/`<select>` in the DOM whose own Escape handler
    // could take effect — without this branch the cell would stay locked
    // until the reply with no way out (the user may abort at any time, even
    // while the host is still answering).
    if (ev.key === 'Escape' && activeEditor?.pending) { cancelEdit(); return; }
    const isUndoKey =
      (ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'z';
    if (!isUndoKey) return;
    if (activeEditor) return;
    const ae = document.activeElement as HTMLElement | null;
    const tag = ae?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable) return;
    if (undoStack.isEmpty()) return;
    ev.preventDefault();
    const last = undoStack.pop();
    if (!last) return;

    const td = document.querySelector<HTMLTableCellElement>(
      `td[data-ri="${last.ri}"][data-ci="${last.ci}"]`,
    );
    if (td) {
      td.dataset.pendingOld = last.newValue;
      td.dataset.pendingNew = last.oldValue;
      td.dataset.pendingCoords = JSON.stringify(last.coordinates);
      td.classList.add('cell-pending');
      td.textContent = last.oldValue || '';
      refreshTdClassByValue(td, last.oldValue || '');
    }
    const parsed = state.lastMatrix?.cellFlags?.[`${last.ri},${last.ci}`]?.s === 1
      ? parseStringCellValue(last.oldValue || '')
      : parseEditedValue(last.oldValue || '');
    const sendValue: number | string =
      parsed.kind === 'numeric' ? parsed.payload :
      parsed.kind === 'empty'   ? '' :
                                  parsed.payload;
    sendCellEdit({
      ri: last.ri, ci: last.ci, value: sendValue, coordinates: last.coordinates,
      picklistDef: resolvePicklistDefForCell(last.ri, last.ci),
    });
  });
}
