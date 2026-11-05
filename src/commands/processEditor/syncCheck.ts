import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { fetchProcessSections } from '../../tm1Rest/processApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseSections } from '../../utils/proFile';

/** Checks if the local document is in sync with the server version.
 *  Returns:
 *    'ok'     — proceed (in sync, or user chose "Run anyway")
 *    'deploy' — user chose "Deploy & Run"
 *    'cancel' — user cancelled
 */
export async function checkAndConfirmSync(
  processName: string,
  document: vscode.TextDocument,
  config: Tm1Config,
): Promise<'ok' | 'deploy' | 'cancel'> {
  const RUN_ANYWAY = vscode.l10n.t('Run anyway');
  const DEPLOY_AND_RUN = vscode.l10n.t('Deploy & Run');
  const CANCEL = vscode.l10n.t('Cancel');
  let serverSections;
  try {
    serverSections = await fetchProcessSections(processName, config);
  } catch (err) {
    // Network or server error — warn the user and let them decide
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t('"{0}": server connection failed ({1}). Run anyway?', processName, errMsg(err)),
      RUN_ANYWAY,
      CANCEL,
    );
    if (action === RUN_ANYWAY) { return 'ok'; }
    return 'cancel';
  }

  if (serverSections === null) {
    const action = await vscode.window.showErrorMessage(
      vscode.l10n.t('"{0}" does not exist on the server yet. Please deploy it first.', processName),
      DEPLOY_AND_RUN,
      CANCEL,
    );
    if (action === DEPLOY_AND_RUN) { return 'deploy'; }
    return 'cancel';
  }

  const local = parseSections(document.getText());
  const norm = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();

  const inSync =
    norm(local.prolog)   === norm(serverSections.prolog)   &&
    norm(local.metadata) === norm(serverSections.metadata) &&
    norm(local.data)     === norm(serverSections.data)     &&
    norm(local.epilog)   === norm(serverSections.epilog);

  if (inSync) { return 'ok'; }

  const action = await vscode.window.showWarningMessage(
    vscode.l10n.t('"{0}": local version differs from the server.', processName),
    DEPLOY_AND_RUN,
    RUN_ANYWAY,
    CANCEL,
  );
  if (action === DEPLOY_AND_RUN) { return 'deploy'; }
  if (action === RUN_ANYWAY) { return 'ok'; }
  return 'cancel';
}
