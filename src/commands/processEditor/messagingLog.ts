import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { outputChannel } from '../../utils/outputChannel';

/**
 * Lazy-init OutputChannel for the Process Editor webview message router.
 * Surfaces fetch/lookup failures that would otherwise be silently swallowed
 * (Post-H17 #9b CAT-D fix).
 *
 * Pattern mirrors `deploy.ts` — lazy-init so import is side-effect-free
 * for tests and provider modules.
 */
let _out: vscode.OutputChannel | undefined;
function getOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 Process Editor'); }
  return _out;
}

/**
 * Log a fetch/lookup error from the message router. Does not show the channel
 * to the user — keeps the graceful-degradation UX (empty dropdown) while
 * preserving debug info for later inspection via View → Output → "TM1 Process Editor".
 */
export function logFetchError(operation: string, err: unknown): void {
  const msg = errMsg(err);
  getOut().appendLine(`[${new Date().toISOString()}] ${operation} failed: ${msg}`);
}
