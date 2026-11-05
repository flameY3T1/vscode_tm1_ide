/**
 * Mirrors the editor state to the extension host while the user types.
 *
 * A `WebviewPanel` close cannot be intercepted — `onDidDispose` fires when the
 * panel is already gone, so the host cannot ask the webview for its content at
 * that point. Whatever it is going to park has to be there BEFORE the close, so
 * the editor pushes it as it goes.
 *
 * Debounced: the payload carries all four sections plus parameters, data source
 * and variables, which is far too much to post on every keystroke.
 */

import { currentSections } from './sections';
import { getParameters } from './parameters';
import { getDataSource } from './dataSource';
import { getVariables } from './variables';
// MUST come from `./state` (which holds `acquireVsCodeApi()`), never a
// `declare const vscode` — that compiles fine and then throws
// `ReferenceError: vscode is not defined` in the bundle, because there is no
// global by that name. See `noWebviewVscodeGlobal.test.ts`.
import { vscode } from './state';
import { scheduleFileSync } from './fileMode';

/**
 * Quiet period before mirroring. Long enough that continuous typing posts
 * nothing, short enough that a pause of a second is already covered.
 */
export const DRAFT_SYNC_DEBOUNCE_MS = 1000;

let timer: ReturnType<typeof setTimeout> | null = null;

/** Posts the current state to the host. Exported for the flush-on-hide path. */
export function sendDraftNow(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  vscode.postMessage({
    type: 'processDraft',
    sections: currentSections(),
    parameters: getParameters(),
    dataSource: getDataSource(),
    variables: getVariables(),
  });
}

/** Schedules a mirror of the current state; repeated calls restart the timer. */
export function scheduleDraftSync(): void {
  if (timer) { clearTimeout(timer); }
  timer = setTimeout(() => { timer = null; sendDraftNow(); }, DRAFT_SYNC_DEBOUNCE_MS);
}

/**
 * Marks the document changed: tells the host to flip the dirty flag AND keeps
 * the recovery mirror current. Every edit path calls this instead of posting
 * `monacoContentChanged` on its own — a path that forgets the mirror produces
 * an editor whose unsaved work is silently unrecoverable.
 */
export function markContentChanged(): void {
  vscode.postMessage({ type: 'monacoContentChanged' });
  scheduleDraftSync();
  scheduleFileSync();
}
