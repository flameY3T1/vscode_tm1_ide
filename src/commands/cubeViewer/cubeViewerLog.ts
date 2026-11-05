import * as vscode from 'vscode';
import { outputChannel } from '../../utils/outputChannel';

/**
 * Lazy-init OutputChannel for the Cube Viewer.
 *
 * Notes land where a cube-viewer user would look for them — View → Output →
 * "TM1 Cube Viewer". `TM1 Background` (bestEffortLog) is the wrong shelf for
 * this: nothing about the grid points a user there, so a note dropped in it is
 * only formally not silent.
 *
 * Pattern mirrors `processEditor/messagingLog.ts` — lazy so importing this
 * module stays side-effect-free for tests.
 */
let _out: vscode.OutputChannel | undefined;
function getOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 Cube Viewer'); }
  return _out;
}

/**
 * Record a deliberate limitation that must not stay silent — a skipped
 * picklist read, for instance. Never shows the channel: the grid stays usable,
 * and popping an output panel over a working view would be worse than the
 * limitation itself. English like the sibling log modules; this is a
 * diagnostic channel and does not go through the l10n bundle.
 */
export function logCubeViewer(message: string): void {
  getOut().appendLine(`[${new Date().toISOString()}] ${message}`);
}
