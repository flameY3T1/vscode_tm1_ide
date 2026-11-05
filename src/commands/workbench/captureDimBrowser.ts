import type * as vscode from 'vscode';
import { askPanelState } from './askPanelState';
import { sanitizeDimBrowserState, type DimBrowserState } from './captureStatePure';

export type { DimBrowserState };

/**
 * What a dimension browser shows.
 *
 * Unlike the cube viewer, there is NO coarse state here beyond the
 * dimension name — that already sits in the directory's `target`.
 * Everything else (hierarchy, alias, subset, and above all the intent
 * behind the visible rows) lives exclusively in the webview.
 *
 * If it does not answer, `{ stateRead: false }` comes back: the window is
 * saved and later opens on the dimension — as before —, but the selection
 * window says beforehand that the state was not read.
 */
export async function captureDimBrowserState(panel: vscode.WebviewPanel): Promise<DimBrowserState> {
  return sanitizeDimBrowserState(await askPanelState(panel));
}
