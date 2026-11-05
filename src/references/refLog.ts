import * as vscode from 'vscode';
import { outputChannel } from '../utils/outputChannel';

let _channel: vscode.OutputChannel | undefined;

function channel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = outputChannel('TM1 References');
  }
  return _channel;
}

function debugEnabled(): boolean {
  return vscode.workspace.getConfiguration('tm1').get<boolean>('references.debugLog') === true;
}

export function refLog(msg: string): void {
  if (debugEnabled()) {
    channel().appendLine(msg);
  }
}

export function refWarn(msg: string): void {
  channel().appendLine(`[warn] ${msg}`);
}

export function refError(msg: string): void {
  channel().appendLine(`[error] ${msg}`);
}
