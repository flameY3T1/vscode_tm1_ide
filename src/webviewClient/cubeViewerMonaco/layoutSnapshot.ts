/**
 * The viewer layout survives a webview reload.
 *
 * "Move into New Window" rebuilds the iframe even with
 * `retainContextWhenHidden`; the host then answers the new `webviewReady` with
 * the `initData` of the FIRST open. Every pivot, title pick and filter since
 * was gone — an alternate hierarchy moved to the titles fell back to the rows.
 * The webview state (`vscode.setState`) travels with the panel, so the layout
 * is written there when the iframe goes away and read back on `initData`.
 *
 * Only what describes the query is kept, not the loaded cells: the restore
 * asks the server again, like the refresh button. The axis members are part of
 * that query: without a loaded matrix they cannot be derived any more, and the
 * restore asked for whole dimensions (review 2026-11-02, C3).
 */
import type { CubeViewerState } from './state';

const LAYOUT_FIELDS = [
  'rowDims', 'colDims', 'titleDims', 'titleAssignments', 'titleOverride',
  'dimSelections', 'dimAliases', 'collapsed', 'displayFormats', 'numFmt',
  'existingViewName', 'existingViewIsPrivate', 'isMdxView', 'originalMdx', 'lastInlineMdx',
] as const;

type LayoutField = typeof LAYOUT_FIELDS[number];

export interface LayoutSnapshot {
  cubeName: string;
  suppressRows: boolean;
  suppressCols: boolean;
  fields: Pick<CubeViewerState, LayoutField>;
  /** Axis members per dimension, as the next refresh would send them. */
  dimSubsets: Record<string, string[]>;
  /** `localFocus` with its Set as a list — JSON has no Set. */
  localFocus: { dim: string; visible: string[] } | null;
}

export function snapshotLayout(
  s: CubeViewerState, suppressRows: boolean, suppressCols: boolean, dimSubsets: Record<string, string[]>,
): LayoutSnapshot {
  const fields = {} as Record<LayoutField, unknown>;
  for (const k of LAYOUT_FIELDS) { fields[k] = s[k]; }
  const localFocus = s.localFocus && { dim: s.localFocus.dim, visible: [...s.localFocus.visible] };
  // JSON round trip: the webview state is serialized anyway, and a copy keeps
  // later in-place edits of `state` out of the snapshot.
  return JSON.parse(JSON.stringify({
    cubeName: s.cubeName, suppressRows, suppressCols, fields, dimSubsets, localFocus,
  })) as LayoutSnapshot;
}

/** The stored layout, if it belongs to `cubeName`. */
export function storedLayout(raw: unknown, cubeName: string): LayoutSnapshot | null {
  const snap = (raw as { cubeLayout?: LayoutSnapshot } | undefined)?.cubeLayout;
  return snap && snap.cubeName === cubeName && snap.fields ? snap : null;
}

export function applyLayout(target: CubeViewerState, snap: LayoutSnapshot): void {
  Object.assign(target, snap.fields);
  target.restoredDimSubsets = snap.dimSubsets ?? {};
  target.localFocus = snap.localFocus ? { dim: snap.localFocus.dim, visible: new Set(snap.localFocus.visible) } : null;
}
