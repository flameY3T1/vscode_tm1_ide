import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { requireServerConfig } from '../serverManager';
import { fetchNames, invalidateCache } from '../../providers/fetchNames';
import { DimensionEditorManager } from './dimensionEditor';
import { createDimension as createDimensionRest } from '../../tm1Rest/dimensionApi';
import { validateDimName } from '../../dimensionEditor/dimNameValidation';

export async function createDimensionCommand(
  node: any,
  refreshTree: () => void,
): Promise<void> {
  const cfg = requireServerConfig(node?.meta?.serverId);
  if (!cfg) { return; }

  const existing = await fetchNames('Dimensions', cfg).catch(() => [] as string[]);

  const raw = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Name of the new dimension'),
    placeHolder: vscode.l10n.t('e.g. Year'),
    ignoreFocusOut: true,
    validateInput: (val: string) => validateDimName(val, existing),
  });
  if (raw === undefined) return;

  const name = raw.trim();
  const body = {
    Name: name,
    Hierarchies: [{ Name: name, Elements: [] }],
  };

  try {
    await createDimensionRest(cfg, body, vscode.l10n.t('Could not create dimension "{0}"', name));
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
    return;
  }

  invalidateCache('Dimensions', cfg.serverUrl);
  refreshTree();
  vscode.window.showInformationMessage(vscode.l10n.t('TM1: Dimension "{0}" created.', name));
  await DimensionEditorManager.open(name, cfg);
}
