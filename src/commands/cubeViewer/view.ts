import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { probeViewKind, createView, deleteView, updateView, type ViewKind } from '../../tm1Rest/cubeApi';
import { errMsg } from '../../utils/errMsg';
import { logBestEffort } from '../../providers/bestEffortLog';
import { hierODataPath, isAltHierKey, splitHierKey } from '../../utils/hierKeyPure';
import { listSubsetElementNames } from '../../tm1Rest/subsetApi';
import { _dimSelections, _panels, _tempViews, enc, knownNamesFrom, knownNamesPerDim, post } from './state';

export type { ViewDimSelection } from '../../cubeViewer/viewTypes';
import type { ViewDimSelection } from '../../cubeViewer/viewTypes';
import { _fetchDimElements, _fetchViewAxisSubsets, VIEW_AXIS_ELEMENTS_MAX } from './fetch';
import { _executeView } from './executeView';
import { _executeMdxInline } from './executeMdxInline';
import { buildAxisSetMdx, buildViewMdx } from '../../cubeViewer/axisMdxPure';
import { assertLayoutExecutable } from './viewSizeGuard';
import { _buildAxisMeta } from './axisMeta';
import { dropPanelCellset, _stashPageContext } from './cellsetState';
import { _picklistDims, _picklistMaps } from './picklistWiring';
import type { ExecResult } from './cellset';

/**
 * Warnings already shown for a panel/view/reason combination. A degraded
 * axis rebuild is sticky (the view does not change), or every refresh would
 * pop the same message again.
 */
const _axisWarned = new Set<string>();

/**
 * Decorate an executed cellset with axis metadata and picklist maps, stash the
 * page context and post it as `cellData`. Every path that shows a grid goes
 * through here; five hand-written copies of the 14-field object had already
 * started to drift (review 2026-10-03, B1).
 *
 * `dimSelections` names the selections the matrix was built from (temp views,
 * custom axes); without it the panel's stored selections apply.
 */
export async function postDecoratedMatrix(
  panelKey: string, panel: vscode.WebviewPanel, cubeName: string, config: Tm1Config,
  matrix: ExecResult, reqId: number, keepUndo: boolean,
  dimSelections?: Record<string, ViewDimSelection | undefined>,
): Promise<void> {
  const known = (dims: readonly string[]): string[][] =>
    dimSelections ? knownNamesFrom(dimSelections, dims) : knownNamesPerDim(panelKey, dims);
  const [rowMeta, colMeta, picklists] = await Promise.all([
    _buildAxisMeta(matrix.rowDims, matrix.rowTuples, config, known(matrix.rowDims)),
    _buildAxisMeta(matrix.colDims, matrix.colTuples, config, known(matrix.colDims)),
    _picklistMaps(config, cubeName, _picklistDims(matrix)),
  ]);
  _stashPageContext(panelKey, matrix.rowDims, rowMeta.levelMaps);
  post(panel, { type: 'cellData', reqId, keepUndo: keepUndo || undefined, matrix: {
    ...matrix,
    rowLevels: rowMeta.levels, rowParents: rowMeta.parents, rowAllParents: rowMeta.allParents,
    rowHasChildren: rowMeta.hasChildren,
    colLevels: colMeta.levels, colParents: colMeta.parents, colAllParents: colMeta.allParents,
    colHasChildren: colMeta.hasChildren,
    picklistByElem: picklists.picklistByElem,
    picklistByRuleElem: picklists.picklistByRuleElem,
    picklistCubePresent: picklists.picklistCubePresent,
  } });
}

function _warnAxisDegraded(panelKey: string, viewName: string, reason: string, message: string): void {
  const key = `${panelKey}|${viewName}|${reason}`;
  if (_axisWarned.has(key)) { return; }
  _axisWarned.add(key);
  void vscode.window.showWarningMessage(message);
}

/**
 * Panel-dispose hook for the `_axisWarned` state (called from
 * `messaging.ts#clearPanelMessagingState`, alongside `_panelViewState` and
 * others).
 */
export function clearViewAxisWarnings(panelKey: string): void {
  const prefix = `${panelKey}|`;
  for (const key of _axisWarned) {
    if (key.startsWith(prefix)) { _axisWarned.delete(key); }
  }
}

/**
 * The saved view's OWN axis subsets, restricted to the dims currently on an
 * axis — the baseline that keeps a large view at full size when it has to be
 * re-materialised as a NativeView (H3).
 *
 * Every degradation is surfaced: a THROW, an unreadable axis (`null`, e.g. an
 * MDXView or a `value`-less body) and an axis too large to re-materialise all
 * end in the caller's truncated client baseline, so the user is told instead of
 * silently getting ~10k rows (MED-1).
 */
export async function _viewAxisBaseline(
  panelKey: string, cubeName: string, viewName: string, isPrivate: boolean,
  targetIsPrivate: boolean, rowDims: string[], colDims: string[], config: Tm1Config,
): Promise<Record<string, ViewDimSelection>> {
  const axisDims = new Set([...rowDims, ...colDims]);
  const out: Record<string, ViewDimSelection> = {};
  let res: Awaited<ReturnType<typeof _fetchViewAxisSubsets>>;
  try {
    res = await _fetchViewAxisSubsets(cubeName, viewName, isPrivate, config, { targetIsPrivate });
  } catch (err) {
    logBestEffort('CubeViewer', `read axis subsets of view "${viewName}"`, err);
    _warnAxisDegraded(panelKey, viewName, 'error', vscode.l10n.t(
      'Could not read the axes of view "{0}" — only the rows already loaded are used.', viewName));
    return out;
  }
  if (!res) {
    // Not a throw: any non-2xx on /Rows or /Columns. Silent before — that turned
    // a deterministic truncation into an intermittent one.
    logBestEffort('CubeViewer', `read axis subsets of view "${viewName}"`,
      new Error('axes not readable (non-2xx or empty body)'));
    _warnAxisDegraded(panelKey, viewName, 'unreadable', vscode.l10n.t(
      'Could not read the axes of view "{0}" — only the rows already loaded are used.', viewName));
    return out;
  }
  for (const [d, sel] of Object.entries(res.subsets)) {
    if (axisDims.has(d)) { out[d] = sel; }
  }
  const over = res.oversized.filter((d) => axisDims.has(d));
  if (over.length > 0) {
    _warnAxisDegraded(panelKey, viewName, 'oversized', vscode.l10n.t(
      'View "{0}": the axis of {1} holds more than {2} members and cannot be rebuilt — only the rows already loaded are used.',
      viewName, over.join(', '), VIEW_AXIS_ELEMENTS_MAX));
  }
  return out;
}

/**
 * THE ONE refresh decision, behind `messaging.ts#refreshData` (also the
 * refresh the webview sends after a write): as soon as a saved view is open AND the
 * user has set neither an explicit dim filter nor a context override, the
 * view is re-read server-side. Otherwise the working state wins — baseline
 * (from `dimSubsets`) <- the view's own axis subsets (only for a pure
 * context override, H3) <- `dimSel` (explicit user selection, e.g. an
 * element just added in the Dimension Browser). Behavior extracted
 * unchanged from `refreshData` — this function's existing tests are the
 * proof.
 */
export async function refreshCurrentLayout(
  panelKey: string, panel: vscode.WebviewPanel, cubeName: string,
  viewName: string | undefined, isPriv: boolean,
  rowDims: string[], colDims: string[],
  titleAssignments: Record<string, string>,
  dimSubsets: Record<string, string[]>,
  hasTitleOverride: boolean,
  suppressRows: boolean, suppressCols: boolean,
  config: Tm1Config,
  reqId: number,
  // Defect 2 (fix wave 2026-08-12): ONLY the refresh the webview sends after
  // its own write sets this — otherwise the webview clears the undo stack on
  // EVERY `cellData`, and the entry that the edit just confirmed had pushed
  // itself would be gone again immediately.
  keepUndo = false,
): Promise<void> {
  const dimSel = _dimSelections.get(panelKey) ?? {};
  const hasUserDimFilters = Object.keys(dimSel).length > 0;
  if (viewName && !hasUserDimFilters && !hasTitleOverride) {
    await _readExistingView(panelKey, panel, cubeName, viewName, isPriv, rowDims[0], colDims[0], config, reqId, keepUndo);
    return;
  }
  if (rowDims.length === 0 || colDims.length === 0) {
    throw new Error(vscode.l10n.t('At least one dimension required in rows and columns.'));
  }
  // Baseline merge: dimSubsets from the caller (the current matrix tuples for
  // all row+col dims) supplies the view subsets for dims that are not
  // explicitly filtered. dimSel entries (user edits) win.
  // Fix round 1, FINDING 3 (deliberate, not accidental): this branch also
  // runs after a write WITHOUT a saved view — the same baseline rule as for
  // any normal refresh. Previously, a dim with no explicit selection fell
  // back to `TM1SUBSETALL(...)` (the whole dimension); now `dimSubsets`
  // supplies only the LOADED tuples. On a paged/pivoted matrix (not all rows
  // loaded), the refresh after the write therefore comes back with only the
  // loaded rows instead of the full dimension — exactly the behavior of
  // `refreshData` without a context override, deliberately carried over here
  // rather than inherited by accident.

  const baseline: Record<string, { kind: 'elements'; names: string[] }> = {};
  for (const d of Object.keys(dimSubsets)) {
    const names = dimSubsets[d];
    if (Array.isArray(names) && names.length > 0) {
      baseline[d] = { kind: 'elements', names };
    }
  }
  // H3: a saved view that lands here ONLY because of a context pick must
  // keep its own axes. `dimSubsets` comes from the loaded tuples (one cell
  // page); on a 300k-row view, the temp view would otherwise silently shrink
  // to ~10k rows. Take the view's own server-side subsets instead — by
  // reference, wherever the view uses a registered/MDX subset, so that
  // nothing gets enumerated. The temp NativeView is always PUBLIC, so
  // targetIsPrivate=false.
  const viewSel: Record<string, ViewDimSelection> =
    (viewName && !hasUserDimFilters && hasTitleOverride)
      ? await _viewAxisBaseline(panelKey, cubeName, viewName, isPriv, false, rowDims, colDims, config)
      : {};
  const mergedSel: Record<string, any> = { ...baseline, ...viewSel, ...dimSel };
  await _refreshWithTempView(panelKey, panel, cubeName, rowDims, colDims, titleAssignments, mergedSel, suppressRows, suppressCols, config, reqId, keepUndo);
}

/**
 * Run the panel's active inline MDX and post it as `cellData`. The one place
 * both a user refresh and the refresh after a write go through — a view
 * opened with its format members unwrapped must never fall back to executing
 * the stored view, whose calculated members TM1 reports as not writable.
 * Resolves `false` when the MDX failed (the error is already posted).
 */
export async function refreshInlineMdx(
  panelKey: string, panel: vscode.WebviewPanel, cubeName: string, mdx: string,
  config: Tm1Config, reqId: number, keepUndo = false,
): Promise<boolean> {
  dropPanelCellset(panelKey);
  try {
    const matrix = await _executeMdxInline(mdx, config, panelKey);
    await postDecoratedMatrix(panelKey, panel, cubeName, config, matrix, reqId, keepUndo);
    return true;
  } catch (err) {
    post(panel, { type: 'error', reqId, message: vscode.l10n.t('MDX execution failed: {0}', errMsg(err)) });
    return false;
  }
}

/**
 * Probe whether a view already exists and reject a non-overwrite save.
 * Shared by the NativeView and MDX-View save paths. Returns whether the
 * view exists (callers DELETE first when overwriting).
 */
async function _assertWritable(
  config: Tm1Config, cubeName: string, viewName: string,
  isPrivate: boolean, overwrite: boolean,
): Promise<ViewKind | null> {
  const kind = await probeViewKind(config, cubeName, viewName, isPrivate, 15000);
  if (kind !== null && !overwrite) {
    throw new Error(vscode.l10n.t('View "{0}" already exists. Confirm overwrite in the dialog.', viewName));
  }
  return kind;
}

/**
 * Overwrite an existing view without ever leaving the server without one.
 *
 * Same type → PATCH: atomic, no window in which the old definition is gone. TM1
 * has no transactions, so a DELETE+POST that fails halfway cannot be rolled back
 * reliably — the compensating POST would fail for the very reason the first one
 * did. Avoiding the window beats trying to repair it.
 *
 * Different type (or unknown) → DELETE+POST, because PATCH cannot convert a
 * NativeView into an MDXView or back: live 11.8 returns HTTP 200 and silently
 * keeps the old type. Here the destructive window is unavoidable, so the caller
 * must say plainly what happened when the POST fails.
 */
async function _writeView(
  config: Tm1Config, cubeName: string, viewName: string, isPrivate: boolean,
  existing: ViewKind | null, want: ViewKind, body: Record<string, any>,
): Promise<void> {
  if (existing === want) {
    // `Name` would be ignored anyway; `@odata.type` must not travel in a PATCH.
    const { Name: _n, ['@odata.type']: _t, ...patch } = body;
    await updateView(config, cubeName, viewName, patch, isPrivate, 30000,
      vscode.l10n.t('View "{0}" could not be updated', viewName));
    return;
  }
  if (existing !== null) {
    await deleteView(config, cubeName, viewName, isPrivate, 15000,
      vscode.l10n.t('Delete view "{0}" (for overwrite)', viewName))
      .catch((err: any) => { if (!/HTTP 404/.test(err?.message ?? '')) { throw err; } });
    try {
      await createView(config, cubeName, body, isPrivate, 30000);
    } catch (err) {
      // The old definition is already gone. Saying only "could not be created"
      // reads as "nothing changed" and sends the user off to retry a view that
      // no longer exists.
      throw new Error(vscode.l10n.t(
        'View "{0}" was deleted for the overwrite, but could not be recreated: {1}. The previous definition is no longer on the server.',
        viewName, errMsg(err)));
    }
    return;
  }
  await createView(config, cubeName, body, isPrivate, 30000);
}

/**
 * Persist a NativeView. Overwriting an existing NativeView goes through PATCH
 * (see `_writeView`) so the stored definition is never absent; only a type
 * change still needs DELETE+POST. Reads element subsets for any dim that has no
 * explicit selection so the resulting view is fully populated.
 */
export async function _saveView(
  cubeName: string, viewName: string, isPrivate: boolean, overwrite: boolean,
  rowDims: string[], colDims: string[],
  titleAssignments: Record<string, string>,
  dimSelections: Record<string, ViewDimSelection>,
  suppressRows: boolean, suppressCols: boolean,
  dimAliases: Record<string, string>,
  config: Tm1Config,
): Promise<string> {
  const existing = await _assertWritable(config, cubeName, viewName, isPrivate, overwrite);

  // Fetch elements for dims with no explicit selection (needed for makeSubset fallback)
  const allAxisDims = [...new Set([...rowDims, ...colDims])];
  // `kind: 'all'` is deliberately NOT handled here anymore: the axis is
  // written as an expression (see `makeSubset`), a name list would only be
  // needed to throw it away again, truncated.
  const dimsToFetch = allAxisDims.filter(d => !dimSelections[d]);
  const elemArrays = await Promise.all(dimsToFetch.map(d => _fetchDimElements(d, config)));
  const elemMap: Record<string, string[]> = {};
  dimsToFetch.forEach((d, i) => { elemMap[d] = elemArrays[i]; });

  const body = _buildNativeViewBody(viewName, rowDims, colDims, titleAssignments, dimSelections, elemMap, dimAliases);
  body.SuppressEmptyRows = suppressRows;
  body.SuppressEmptyColumns = suppressCols;
  // A PATCH replaces each named axis wholesale, so the body must stay complete —
  // `_buildNativeViewBody` always emits Rows, Columns, Titles and the alias.
  await _writeView(config, cubeName, viewName, isPrivate, existing, 'native', body);

  const prefix = isPrivate ? 'Private View' : 'View';
  return existing !== null
    ? vscode.l10n.t('{0} "{1}" overwritten.', prefix, viewName)
    : vscode.l10n.t('{0} "{1}" saved.', prefix, viewName);
}

/**
 * Persists an MDX view. Overwriting an existing MDX view goes through PATCH
 * (see `_writeView`) — the transport sets `If-Match: *` centrally, and the
 * rename trap does not apply to views (`Name` in the body is ignored, live
 * on 11.8). MDX views have no subsets to preserve, so the MDX string alone
 * suffices.
 */
export async function saveMdxView(
  cubeName: string, viewName: string, mdx: string,
  isPrivate: boolean, overwrite: boolean,
  config: Tm1Config,
): Promise<string> {
  const existing = await _assertWritable(config, cubeName, viewName, isPrivate, overwrite);
  const body = { '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: viewName, MDX: mdx };
  await _writeView(config, cubeName, viewName, isPrivate, existing, 'mdx', body);
  const prefix = isPrivate ? 'Private View' : 'View';
  return existing !== null
    ? vscode.l10n.t('{0} "{1}" overwritten.', prefix, viewName)
    : vscode.l10n.t('{0} "{1}" saved.', prefix, viewName);
}

// ── Existing view: direct execute ─────────────────────────────────────────────

export async function _readExistingView(
  panelKey: string, panel: vscode.WebviewPanel,
  cubeName: string, viewName: string, isPrivate: boolean,
  _rowDim: string, _colDim: string,
  config: Tm1Config,
  reqId: number,
  keepUndo = false,
): Promise<void> {
  dropPanelCellset(panelKey);
  const matrix = await _executeView(cubeName, viewName, isPrivate, config, panelKey);
  // The everyday case: a SAVED view. The picklist maps run in the same
  // `Promise.all` as the axis metadata (see `_picklistMaps`) — the same wait
  // time, and no path there throws. NO cell query: the surface comes from
  // attributes and the rule text, everything else individually on
  // double-click.
  await postDecoratedMatrix(panelKey, panel, cubeName, config, matrix, reqId, keepUndo);
}

// ── Custom axis: temp NativeView ───────────────────────────────────────────────

export async function _refreshWithTempView(
  panelKey: string, panel: vscode.WebviewPanel,
  cubeName: string, rowDims: string[], colDims: string[],
  titleAssignments: Record<string, string>,
  dimSelections: Record<string, ViewDimSelection>,
  suppressRows: boolean, suppressCols: boolean,
  config: Tm1Config,
  reqId: number,
  keepUndo = false,
): Promise<void> {
  const prev = _tempViews.get(panelKey);
  if (prev) {
    _tempViews.delete(panelKey);
    deleteView(prev.config, prev.cubeName, prev.viewName, false, 10000)
      .catch(e => logBestEffort('CubeViewer', `delete previous temp view "${prev.viewName}"`, e));
  }

  // The layout is usually expressible as MDX, and reading an MDX cellset is
  // 4–5× faster than reading the one a NativeView produces for the identical
  // grid (measured 11.8, 2026-08-08) — plus it saves creating and deleting the
  // temp view, and the element fetch below. Only a private subset on an axis
  // has no MDX form; that case still takes the view route — except next to an
  // alternate hierarchy, which a NativeView refuses: there the private subset
  // goes in as its member list.
  if ([...rowDims, ...colDims, ...Object.keys(titleAssignments)].some(isAltHierKey)) {
    dimSelections = await _inlinePrivateSubsets(dimSelections, [...rowDims, ...colDims], config);
  }
  const mdx = buildViewMdx({
    cubeName, rowDims, colDims, titleAssignments, dimSelections, suppressRows, suppressCols,
  });
  if (mdx) {
    await assertLayoutExecutable(
      rowDims, colDims,
      (d) => { const s = dimSelections[d]; return !s || s.kind === 'all'; },
      suppressRows || suppressCols,
      config,
    );
    dropPanelCellset(panelKey);
    const matrix = await _executeMdxInline(mdx, config, panelKey);
    matrix.rowDims = rowDims;
    matrix.colDims = colDims;
    // AFTER taking over the axes: the dimension list must name the same axes
    // as the matrix that goes out.
    await postDecoratedMatrix(panelKey, panel, cubeName, config, matrix, reqId, keepUndo, dimSelections);
    return;
  }

  // Only fetch elements for dims that have no explicit selection — `kind: 'all'`
  // travels as an expression (see `makeSubset`), not as a member list.
  const allAxisDims = [...new Set([...rowDims, ...colDims])];
  const dimsToFetch = allAxisDims.filter(d => !dimSelections[d]);
  const elemArrays = await Promise.all(dimsToFetch.map(d => _fetchDimElements(d, config)));
  const elemMap: Record<string, string[]> = {};
  dimsToFetch.forEach((d, i) => { elemMap[d] = elemArrays[i]; });

  if (rowDims.some(d => !dimSelections[d] && (elemMap[d]?.length ?? 0) === 0) ||
      colDims.some(d => !dimSelections[d] && (elemMap[d]?.length ?? 0) === 0)) {
    throw new Error(vscode.l10n.t('No elements found for row or column dimension.'));
  }

  const viewName = `}TmpView_VSCode_${Date.now()}`;
  const viewBody = _buildNativeViewBody(viewName, rowDims, colDims, titleAssignments, dimSelections, elemMap);
  viewBody.SuppressEmptyRows = suppressRows;
  viewBody.SuppressEmptyColumns = suppressCols;
  await createView(config, cubeName, viewBody, false, 30000);
  // Closed while loading: the dispose cleanup has already run, so the view
  // would stay on the server. Delete it here instead of registering it.
  if (_panels.get(panelKey) !== panel) {
    deleteView(config, cubeName, viewName, false, 10000)
      .catch(e => logBestEffort('CubeViewer', `delete temp view "${viewName}"`, e));
    return;
  }
  _tempViews.set(panelKey, { cubeName, viewName, config });

  dropPanelCellset(panelKey);
  try {
    const matrix = await _executeView(cubeName, viewName, false, config, panelKey);
    // Override with the axis dims we explicitly chose for this NativeView
    matrix.rowDims = rowDims;
    matrix.colDims = colDims;
    await postDecoratedMatrix(panelKey, panel, cubeName, config, matrix, reqId, keepUndo, dimSelections);
  } finally {
    _tempViews.delete(panelKey);
    deleteView(config, cubeName, viewName, false, 10000)
      .catch(e => logBestEffort('CubeViewer', `delete temp view "${viewName}"`, e));
  }
}

// ── NativeView body builder (shared by temp views & persistent save) ──────────

// Every `…@odata.bind` value is a RESOURCE PATH, not an OData literal, so it
// needs `enc` (= quote-double + `encodeURIComponent`), not `esc` (quote-double
// only): a dim/subset/element name containing `/`, `#` or `?` — all legal in
// TM1 — would otherwise split the path, cut it off at a fragment or start a
// query. Same reasoning as `cubeWriteApi#buildTupleRefs` / `buildTupleBind`.
// MDX strings (`Expression`) and plain properties (`Alias`) are NOT paths and
// keep their own escaping.

/** Private named subsets on `keys` replaced by their member list (MDX cannot name them). */
async function _inlinePrivateSubsets(
  sels: Record<string, ViewDimSelection>, keys: string[], config: Tm1Config,
): Promise<Record<string, ViewDimSelection>> {
  const out = { ...sels };
  await Promise.all(keys.map(async (k) => {
    const s = out[k];
    if (s?.kind !== 'namedSubset' || !s.isPrivate) { return; }
    const { dim, hier } = splitHierKey(k);
    const { elements } = await listSubsetElementNames(config, dim, hier, s.name, true);
    out[k] = { kind: 'elements', names: elements };
  }));
  return out;
}

function _buildNativeViewBody(
  viewName: string,
  rowDims: string[], colDims: string[],
  titleAssignments: Record<string, string>,
  dimSelections: Record<string, ViewDimSelection>,
  elemMap: Record<string, string[]>,
  dimAliases: Record<string, string> = {},
): any {
  // TM1 refuses alternate hierarchies in a NativeView outright: 400 "Alternative
  // hierarchy cannot be assigned to native views." (measured 11.8, 2026-09-28).
  if ([...rowDims, ...colDims, ...Object.keys(titleAssignments)].some(isAltHierKey)) {
    throw new Error(vscode.l10n.t('A layout with an alternate hierarchy can only be saved as an MDX view.'));
  }
  function makeSubset(dim: string) {
    const sel = dimSelections[dim];
    const hier = hierODataPath(dim);
    // TM1 stores the display alias as the subset's `Alias` property; only emit
    // it when set so views without an alias stay byte-for-byte as before.
    const aliasProp = dimAliases[dim] ? { Alias: dimAliases[dim] } : {};
    if (sel?.kind === 'expression') {
      // MDX subset carried over from a saved view — reproduces the axis at any
      // size without enumerating members.
      return {
        '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
        'Hierarchy@odata.bind': hier,
        Expression: sel.expression,
        ...aliasProp,
      };
    }
    if (sel?.kind === 'all') {
      // Explicitly the whole dimension ("All" in the Dimension Browser). As
      // an expression, not as a member list: `_fetchDimElements` caps at 500
      // names, so an enumerated axis would be silently truncated.
      return {
        '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
        'Hierarchy@odata.bind': hier,
        Expression: buildAxisSetMdx(dim, sel),
        ...aliasProp,
      };
    }
    if (sel?.kind === 'elements' && sel.names.length > 0) {
      return {
        '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
        'Hierarchy@odata.bind': hier,
        'Elements@odata.bind': sel.names.map(e => `${hier}/Elements('${enc(e)}')`),
        ...aliasProp,
      };
    }
    if (sel?.kind === 'consolidation') {
      return {
        '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
        'Hierarchy@odata.bind': hier,
        'Elements@odata.bind': [`${hier}/Elements('${enc(sel.name)}')`],
        ...aliasProp,
      };
    }
    const elems = elemMap[dim] ?? [];
    return {
      '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
      'Hierarchy@odata.bind': hier,
      'Elements@odata.bind': elems.map(e => `${hier}/Elements('${enc(e)}')`),
      ...aliasProp,
    };
  }

  /** One row/column axis entry. A registered subset is bound BY REFERENCE
   *  (`Subset@odata.bind`) — no member list travels, so the axis keeps its full
   *  size; everything else falls back to an inline anonymous subset. */
  function makeAxisEntry(dim: string) {
    const hier = hierODataPath(dim);
    const sel = dimSelections[dim];
    if (sel?.kind === 'namedSubset') {
      // Public vs. private subset collection — the origin travels on the
      // selection (`_fetchViewAxisSubsets`). Binding `Subsets(…)` for a private
      // subset either 404s or silently picks a same-named public subset.
      const coll = sel.isPrivate ? 'PrivateSubsets' : 'Subsets';
      const alias = dimAliases[dim];
      // A BOUND subset carries its own `Alias` — the axis entry has no slot for
      // a per-view override, so `Subset@odata.bind` would drop the alias the
      // user picked in the viewer. Reproduce the subset by MDX instead: the
      // reference is still symbolic (any axis size), and the AnonymousSubset
      // wrapper can carry `Alias`. Only for PUBLIC subsets — TM1SUBSETTOSET
      // cannot address a private subset, so there the bind (and the subset's
      // own alias) wins over the override.
      if (alias && !sel.isPrivate) {
        return {
          'Hierarchy@odata.bind': hier,
          Subset: {
            '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
            'Hierarchy@odata.bind': hier,
            Expression: buildAxisSetMdx(dim, sel),
            Alias: alias,
          },
        };
      }
      return {
        'Hierarchy@odata.bind': hier,
        'Subset@odata.bind': `${hier}/${coll}('${enc(sel.name)}')`,
      };
    }
    return { 'Hierarchy@odata.bind': hier, Subset: makeSubset(dim) };
  }

  return {
    '@odata.type': '#ibm.tm1.api.v1.NativeView',
    Name: viewName,
    Rows: rowDims.map(makeAxisEntry),
    Columns: colDims.map(makeAxisEntry),
    Titles: Object.entries(titleAssignments).map(([dim, elem]) => {
      const hier = hierODataPath(dim);
      const eb = (e: string) => `${hier}/Elements('${enc(e)}')`;
      // Persist a curated context-dim restriction as a multi-element title subset.
      // TM1 keeps Subset (the restricted list) + Selected (the active member).
      // Only when the active member is inside the curated set — otherwise Selected
      // would fall outside the subset (invalid) → fall back to the single element.
      const sel = dimSelections[dim];
      const restrict = sel?.kind === 'elements' && sel.names.length > 0 && sel.names.includes(elem)
        ? sel.names
        : [elem];
      return {
        'Hierarchy@odata.bind': hier,
        Subset: {
          '@odata.type': '#ibm.tm1.api.v1.AnonymousSubset',
          'Hierarchy@odata.bind': hier,
          'Elements@odata.bind': restrict.map(eb),
        },
        'Selected@odata.bind': eb(elem),
      };
    }),
  };
}
