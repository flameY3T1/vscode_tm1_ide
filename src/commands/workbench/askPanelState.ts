import type * as vscode from 'vscode';
import { awaitStateReply, nextAskToken, resolveStateReply } from './stateAsk';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview as CubeViewerIn } from '../../webviewClient/cubeViewerMonaco/protocol';
import type { HostToWebview as DimBrowserIn } from '../../webviewClient/dimensionBrowser/protocol';

/**
 * Cap per window.
 *
 * 500 ms. All windows are asked CONCURRENTLY, not one after another — with
 * 20 windows, doing them in sequence would take ten seconds in the worst
 * case, while the concurrent version stays at half a second.
 *
 * When it runs out, the coarse state is saved and NOTED in the selection
 * window. That note is the actual point: without it, someone saves in good
 * faith and only notices the loss when restoring.
 */
export const STATE_ASK_TIMEOUT_MS = 500;

/**
 * Asks a panel for its state.
 *
 * `undefined` means "not read" — not "empty". There are three ways to get
 * there: the panel does not answer in time, its script does not know
 * `requestState`, or it has already been disposed (in which case
 * `panel.webview` itself already throws). All three are normal outcomes and
 * must not tip over the collection.
 */
export async function askPanelState(
  panel: vscode.WebviewPanel, timeoutMs: number = STATE_ASK_TIMEOUT_MS,
): Promise<unknown> {
  const token = nextAskToken();
  const waiting = awaitStateReply(token, timeoutMs);
  try {
    // Every stateful window kind (cube viewer, dimension browser) carries this
    // message in its protocol; the intersection keeps the shape aligned in both.
    void postTo<CubeViewerIn & DimBrowserIn>(panel.webview, { type: 'requestState', token });
  } catch {
    // Disposed panel. Clear the entry immediately instead of letting the
    // cap run out — otherwise the selection window would hang for half a
    // second on a window that no longer even exists.
    resolveStateReply(token, undefined);
    return undefined;
  }
  return await waiting;
}
