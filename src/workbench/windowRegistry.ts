/**
 * Bookkeeping of the currently open TM1 windows.
 *
 * Deliberately dumb: the directory remembers WHAT is open and interprets nothing.
 * It knows no individual window kind and calls nothing on a panel — the
 * panel is only a recognition token here. Interpretation happens in
 * `src/commands/workbench/windowKinds.ts`, which sits one layer higher.
 *
 * The reason for this separation: `webviews/webviewPanelHost.ts` must be able
 * to register and sits deep. If it needed the child table for that — and with it all
 * the managers —, exactly the dependency clump would arise that `npm run lint:deps`
 * rejects.
 */

/** Identity only. At runtime a `vscode.WebviewPanel`, deliberately opaque here. */
export type WindowPanel = object;

export interface OpenWindow {
  /** Key in the child table. For host panels the `viewType`. */
  kind: string;
  /** The panel key, unchanged. The table interprets it, not we. */
  rawKey: string;
  panel: WindowPanel;
  /** Only set if the registrant knows it without interpretation. */
  serverId?: string;
  target?: string;
}

const _windows: OpenWindow[] = [];

/**
 * Registers a window. An already known panel is replaced,
 * otherwise the registration is appended at the end. The registrant knows
 * its panel and thereby signals: "That's me".
 */
export function registerWindow(w: OpenWindow): void {
  const existing = _windows.findIndex(x => x.panel === w.panel);
  if (existing >= 0) {
    _windows[existing] = w;
  } else {
    _windows.push(w);
  }
}

/**
 * Unregisters a window. It is looked up by panel identity,
 * not by key. Unknown panels are silently ignored.
 */
export function unregisterWindow(panel: WindowPanel): void {
  const idx = _windows.findIndex(x => x.panel === panel);
  if (idx >= 0) {
    _windows.splice(idx, 1);
  }
}

/**
 * Liefert alle offenen Fenster in Anmeldereihenfolge.
 */
export function listWindows(): OpenWindow[] {
  return [..._windows];
}

/**
 * Clears the directory. For testing only.
 */
export function clearWindowsForTest(): void {
  _windows.length = 0;
}
