import type * as vscode from 'vscode';
import { _activeInlineMdx } from '../cubeViewer/state';
import { getPanelViewIdentity } from '../cubeViewer/messaging';
import { askPanelState } from './askPanelState';
import { sanitizeCubeViewerState, type CubeViewerState } from './captureStatePure';

export type { CubeViewerState };

/**
 * What a cube viewer shows.
 *
 * Both pieces already exist and only need to be read: the view sits in the
 * panel key (`${serverKey}:${cube}[:${view}[:priv]]`, built in
 * `cubeViewer/manager.ts`), the free-form query in `_activeInlineMdx`.
 */
/** The coarse state: what is known WITHOUT an answer from the webview. */
type CoarseState = Pick<CubeViewerState, 'viewName' | 'isPrivate' | 'mdx'>;

/**
 * `target` is the cube name that the directory carries anyway. It is needed
 * because `http://host:12354:Cube` and `http://host:Cube:View` have the same
 * number of colons — from the key ALONE it cannot be decided whether the
 * last part is a view or the cube. With the known cube name this becomes a
 * cut instead of a guess.
 */
export function readCubeViewerState(rawKey: string, target?: string): CoarseState {
  // The expression stands ALONGSIDE the view name, not in its place.
  //
  // Previously, an active inline MDX query immediately returned `{ mdx }`
  // here and swallowed the name. But the name is part of the window's
  // IDENTITY: `CubeViewerManager.open` builds the panel key from it
  // (`${server}:${cube}:${view}` versus `${server}:${cube}`). Without it,
  // two cube viewers on the same cube got the SAME key when restoring, and
  // the second call turned into a `reveal()` of the first — only one window
  // opened (click test "test2view", 2026-08-24).
  const mdx = _activeInlineMdx.get(rawKey);
  const out: CoarseState = mdx ? { mdx } : {};
  if (!target) { return out; }
  const at = rawKey.lastIndexOf(`:${target}`);
  if (at < 0) { return out; }
  // Everything after `:<cube>`: empty = plain cube panel, otherwise `:<view>[:priv]`.
  let rest = rawKey.slice(at + target.length + 1);
  if (rest === '') { return out; }
  let isPrivate = false;
  if (rest.endsWith(':priv')) { isPrivate = true; rest = rest.slice(0, -':priv'.length); }
  const viewName = rest.startsWith(':') ? rest.slice(1) : rest;
  if (!viewName) { return out; }
  return { ...out, viewName, isPrivate: isPrivate || undefined };
}

/**
 * The full state: the webview is asked.
 *
 * `readCubeViewerState` alone is not enough — `_activeInlineMdx` is only
 * populated when someone has explicitly run an MDX query, and it gets
 * cleared again when a saved view is loaded (`cubeViewer/messaging.ts`). The
 * usual case — a view opened, axes rearranged, not saved — fell through as
 * a result.
 *
 * The view name stays ALONGSIDE the MDX: otherwise the window would come
 * back as an anonymous query instead of a changed view.
 *
 * It first comes from the mirror in `cubeViewer/messaging.ts`: the panel key
 * only carries the view from when it was OPENED and never changes — whoever
 * loads view B in the same window, or does "save as" B, would otherwise
 * keep being saved as view A. The identity survives a pivot. Without a
 * known view identity, the key stays authoritative, because the name is the
 * window's identity (see `readCubeViewerState`).
 */
export async function captureCubeViewerState(
  panel: vscode.WebviewPanel, rawKey: string, target?: string,
): Promise<CubeViewerState> {
  const coarse = readCubeViewerState(rawKey, target);
  const live = getPanelViewIdentity(rawKey);
  if (live?.viewName) {
    coarse.viewName = live.viewName;
    coarse.isPrivate = live.isPrivate || undefined;
  }
  const reply = await askPanelState(panel);
  return sanitizeCubeViewerState(reply, coarse);
}
