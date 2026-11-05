import * as vscode from 'vscode';
import { outputChannel } from '../../utils/outputChannel';

/**
 * Shared lazy-init "TM1 Execute" OutputChannel.
 *
 * Both the editor-command path (`execute.ts`) and the webview path
 * (`executeFromEditor.ts`) log here. A single memoized instance prevents
 * duplicate same-named channels in the Output dropdown and avoids re-creating
 * the channel on every execution.
 */
let _out: vscode.OutputChannel | undefined;
export function executeOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 Execute'); }
  return _out;
}
