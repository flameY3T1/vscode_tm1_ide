import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { DimElementSelection } from '../dimension/dimensionBrowser';
import type { HostToWebview } from '../../webviewClient/cubeViewerMonaco/protocol';
import type { ViewDimSelection } from '../../cubeViewer/viewTypes';
import { encodeODataKey } from '../../utils/odataKey';
import { postTo } from '../../webviews/typedPost';

export interface TempView { cubeName: string; viewName: string; config: Tm1Config; }

/** Per-panel cell flag — sparse: c=consolidated, r=rule-derived, u=0 means not updateable. */
/** `s: 1` = string cell (the server `Value` is a string, even empty as `""`, measured 2026-09-23). */
export type CellFlag = { c?: 1; r?: 1; u?: 0; s?: 1 };

/** Open cube-viewer panels, keyed by `${serverKey}:${cubeName}[:${viewName}[:priv]]`. */
export const _panels = new Map<string, vscode.WebviewPanel>();

/**
 * Tab title of a cube viewer. One place for `manager.ts` (on open) and
 * `messaging.ts` (after a view switch / save as): the title follows the
 * CURRENTLY loaded view, not the one passed in on open.
 */
export function cubeViewerTitle(serverLabel: string | undefined, cubeName: string, viewName?: string): string {
  const base = viewName ? `${cubeName} / ${viewName}` : `Cube: ${cubeName}`;
  return serverLabel ? `${serverLabel} : ${base}` : base;
}

/** Currently-pinned temp NativeView per panel — cleaned up on panel dispose. */
export const _tempViews = new Map<string, TempView>();

/** Per-panel explicit element selections: panelKey → { dimName: DimElementSelection }. */
export const _dimSelections = new Map<string, Record<string, DimElementSelection>>();

/** Active inline MDX per panel — when set, refresh re-executes this MDX instead of the view. */
export const _activeInlineMdx = new Map<string, string>();

/**
 * Names the client already knows outside the loaded tuples: the active
 * server-side filter list per dimension. Without them, the trimmed axis
 * metadata set is missing the parentage for rows that the grid may touch on
 * the next click — passed in as `extraKnown` in `_buildAxisMeta`.
 *
 * Two forms, because the callers are in different situations: the view-read
 * path only has the `panelKey`, the temp-view path receives its selection
 * as a parameter (and must use exactly the one it also built the grid
 * with).
 */
export function knownNamesFrom(
  sel: Record<string, ViewDimSelection | undefined>, dims: readonly string[],
): string[][] {
  return dims.map((d) => {
    const s = sel[d];
    return s && s.kind === 'elements' ? s.names : [];
  });
}

export function knownNamesPerDim(panelKey: string, dims: readonly string[]): string[][] {
  return knownNamesFrom(_dimSelections.get(panelKey) ?? {}, dims);
}

/** Persistent cellset per panel for scroll-paging: id + dims for $skip math. */
export interface PanelCellset {
  id: string; numCols: number; totalRows: number; config: Tm1Config;
  /** Row dims + per-dim level maps, stashed so scroll pages can compute levels without refetching. */
  rowDims?: string[];
  levelMaps?: Map<string, number>[];
}
export const _cellsets = new Map<string, PanelCellset>();

/** Typed `panel.webview.postMessage` shorthand. */
export function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

export function enc(s: string): string { return encodeODataKey(s); }

// ── Per-panel refresh serialization ───────────────────────────────────────────
// Cell-data-producing refreshes run strictly one after another: a parallel
// second refresh would otherwise (a) delete the first one's temp view while
// its _executeView is still running (a zombie temp view on the server, a
// failure in the middle of execute), and (b) overwrite newer data with older
// data via a stale response. Latest-wins: requests that, by the time they are
// dequeued, have already been superseded by a newer one are skipped entirely.
const _refreshChains = new Map<string, Promise<void>>();
const _refreshSeq = new Map<string, number>();

export function runSerializedRefresh(panelKey: string, task: () => Promise<void>): Promise<void> {
  const token = (_refreshSeq.get(panelKey) ?? 0) + 1;
  _refreshSeq.set(panelKey, token);
  const prev = _refreshChains.get(panelKey) ?? Promise.resolve();
  const next = prev.then(() => {
    if (_refreshSeq.get(panelKey) !== token) { return; } // superseded by a newer request
    return task();
  });
  _refreshChains.set(panelKey, next.catch(() => undefined));
  return next;
}

/** On panel dispose: release the chain and sequence. */
export function clearRefreshState(panelKey: string): void {
  _refreshChains.delete(panelKey);
  _refreshSeq.delete(panelKey);
}
