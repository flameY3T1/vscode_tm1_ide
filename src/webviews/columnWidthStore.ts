import * as vscode from 'vscode';

/**
 * Remembered column widths of the draggable tables (`webviews/columnResize.ts`),
 * per window kind, across restarts in `globalState`.
 *
 * Not in the webview's `localStorage`: every panel gets its own
 * origin, and what is remembered there is gone on the next open.
 */
const KEY = 'tm1.columnWidths.v1';

/** Upper limits against nonsense from the webview — an entry is a handful of numbers. */
const MAX_COLUMNS = 40;
const MAX_WIDTH = 5000;
const MAX_SUBKEY = 40;

let memento: vscode.Memento | undefined;

export function initColumnWidthStore(m: vscode.Memento): void {
  memento = m;
}

/** Own table of the window kind (`kind`) or one of its named ones (`kind:value`). */
function belongsTo(key: string, kind: string): boolean {
  return key === kind || (key.startsWith(kind + ':') && key.length <= kind.length + 1 + MAX_SUBKEY);
}

/** Remembered widths of a window kind, per table key; empty if nothing is remembered (or without activation, e.g. in a test). */
export function savedColumnWidths(kind: string): Record<string, number[]> {
  const all = memento?.get<Record<string, number[]>>(KEY) ?? {};
  return Object.fromEntries(Object.entries(all).filter(([k]) => belongsTo(k, kind)));
}

/** Pure, so it can be checked individually: `null` = discard widths, `undefined` = message invalid. */
export function parseColumnWidths(widths: unknown): number[] | null | undefined {
  if (widths === null) { return null; }
  if (!Array.isArray(widths) || widths.length === 0 || widths.length > MAX_COLUMNS) { return undefined; }
  if (!widths.every(w => typeof w === 'number' && Number.isFinite(w) && w > 0 && w <= MAX_WIDTH)) { return undefined; }
  return widths.map(w => Math.round(w as number));
}

/**
 * Listens for `{ columnWidths: kind[:value], widths }` from the panel and stores it. Only the
 * one window kind of the panel — a webview cannot overwrite a foreign one.
 */
export function rememberColumnWidths(panel: vscode.WebviewPanel, kind: string): void {
  const sub = panel.webview.onDidReceiveMessage((msg: { columnWidths?: unknown; widths?: unknown }) => {
    const key = msg?.columnWidths;
    if (typeof key !== 'string' || !belongsTo(key, kind) || !memento) { return; }
    const widths = parseColumnWidths(msg.widths);
    if (widths === undefined) { return; }
    const all = { ...(memento.get<Record<string, number[]>>(KEY) ?? {}) };
    if (widths === null) { delete all[key]; } else { all[key] = widths; }
    void memento.update(KEY, all);
  });
  panel.onDidDispose(() => sub.dispose());
}
