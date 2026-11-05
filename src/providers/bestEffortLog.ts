import * as vscode from 'vscode';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';

/**
 * Lazy-init OutputChannel for best-effort / background failures that must not
 * interrupt the user (cleanup of temp server objects, optimistic persistence)
 * but should not vanish silently. Inspect via View → Output → "TM1 Background".
 *
 * Pattern mirrors `processEditor/messagingLog.ts` + `deploy.ts` — lazy-init so
 * importing the module is side-effect-free for tests and provider modules.
 */
let _out: vscode.OutputChannel | undefined;
function getOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 Background'); }
  return _out;
}

/** Log a swallowed best-effort failure without surfacing it to the user. */
export function logBestEffort(scope: string, operation: string, err: unknown): void {
  const msg = errMsg(err);
  getOut().appendLine(`[${new Date().toISOString()}] [${scope}] ${operation} failed: ${msg}`);
}
