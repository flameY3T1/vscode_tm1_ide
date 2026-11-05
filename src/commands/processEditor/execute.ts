import * as vscode from 'vscode';
import * as path from 'path';
import { executeProcess, fetchProcessMessageLog } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseParametersFromFileContent, showParameterForm } from './processParams';
import { checkAndConfirmSync } from './syncCheck';
import { deployCommand, parseProcessName, pickDeployTarget } from './deploy';
import { executeOut } from './executeLog';
import { notifyExecuteResult } from './executeNotify';
import { runCancellableProcess } from '../../runState/runCancellableProcess';

const out = executeOut();

function getProcessName(doc: vscode.TextDocument): string | null {
  const ext = path.extname(doc.fileName).toLowerCase();
  if (ext !== '.ti' && ext !== '.pro') { return null; }
  // Prefer 602 header over filename
  return parseProcessName(doc.getText()) ?? path.basename(doc.fileName, ext);
}

export async function executeCommand(cfg?: Tm1Config): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(vscode.l10n.t('No active editor found.'));
    return;
  }

  const processName = getProcessName(editor.document);
  if (!processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('Only .ti or .pro files can be executed.'));
    return;
  }

  if (!cfg) { cfg = await pickDeployTarget(); }
  if (!cfg) { return; } // user cancelled

  // Check server sync before executing
  const sync = await checkAndConfirmSync(processName, editor.document, cfg);
  if (sync === 'cancel') { return; }
  if (sync === 'deploy') { await deployCommand(cfg); }

  // Parse params from local file and show form if any are defined
  const params = parseParametersFromFileContent(editor.document.getText());
  const parameters = await showParameterForm(processName, params, editor.document, cfg.serverUrl);
  if (parameters === undefined) { return; } // cancelled

  const startTime = new Date();
  // Shown in the TM1 "Running" view and the status bar, not as a progress
  // notification — that toast covered the dimension browser and the view
  // element pickers for the whole run. The result toast below stays.
  // `cancelled` is only true when the server-side thread/job was really
  // cancelled; a click whose lookup found nothing used to report "cancelled"
  // while the TI ran on and its result and log were thrown away.
  const { result, cancelled } = await runCancellableProcess(
    vscode.l10n.t('TM1: Executing "{0}"...', processName), processName, cfg,
    () => executeProcess(processName, parameters, cfg),
  );

  if (cancelled || !result) {
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: "{0}" was cancelled.', processName));
    return;
  }

  // Always show message log entries for this process since execution started
  out.clear();
  const logEntries = await fetchProcessMessageLog(processName, startTime, 200, cfg).catch(() => []);
  if (logEntries.length > 0) {
    for (const e of logEntries) {
      out.appendLine(`${e.timestamp}  ${e.level.padEnd(5)}  ${e.message}`);
    }
  }

  if (result.errorMessage) {
    out.appendLine('');
    out.appendLine('--- Error details ---');
    out.appendLine(result.errorMessage);
  }
  out.show(true);
  await notifyExecuteResult(processName, result, cfg);
}
