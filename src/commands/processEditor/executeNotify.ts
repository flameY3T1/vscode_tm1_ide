import * as vscode from 'vscode';
import type { ExecuteResult } from '../../tm1Rest/executionApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { openErrorLog } from '../messageLog';

/**
 * Show the toast for a finished process run. A run with minor errors gets its own
 * warning toast (no longer reported as a clean success); any run with a server
 * error log offers an "Open Error Log" action button that opens the log in a tab.
 * Output-channel logging is done by the caller before this is invoked.
 */
export async function notifyExecuteResult(name: string, result: ExecuteResult, cfg: Tm1Config): Promise<void> {
  if (result.severity === 'success') {
    vscode.window.showInformationMessage(
      vscode.l10n.t('TM1: "{0}" executed successfully ({1}).', name, result.status));
    return;
  }

  const OPEN = vscode.l10n.t('Open Error Log');
  const actions = result.logFilename ? [OPEN] : [];

  const minorMsg = result.minorCount !== undefined
    ? vscode.l10n.t('TM1: "{0}" completed with {1} minor error(s) ({2}).', name, String(result.minorCount), result.status)
    : vscode.l10n.t('TM1: "{0}" completed with minor errors ({1}).', name, result.status);

  const pick = result.severity === 'minor'
    ? await vscode.window.showWarningMessage(minorMsg, ...actions)
    : await vscode.window.showErrorMessage(
        vscode.l10n.t('TM1: "{0}" failed ({1})', name, result.status), ...actions);

  if (pick === OPEN && result.logFilename) { await openErrorLog(result.logFilename, cfg); }
}
