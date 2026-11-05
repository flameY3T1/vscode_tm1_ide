import * as vscode from 'vscode';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { getServerConfig } from '../../serverState/state';
import { CubeViewerManager } from './manager';
import { escapeMdx } from '../../utils/odataKey';

/** Minimal MDX scaffold for a new view. `]`->`]]` escape in the cube name. */
export function buildMdxTemplate(cubeName: string): string {
  const c = escapeMdx(cubeName);
  return `SELECT {} ON COLUMNS, {} ON ROWS FROM [${c}]`;
}

/** Command tm1.newMdxView: opens the cube viewer (empty); the user builds the
 *  MDX in the "MDX" modal and saves it via "Save as new MDX view...". */
export async function newMdxViewCommand(node: Tm1TreeNode): Promise<void> {
  const cubeName = node?.meta?.cubeName as string | undefined;
  if (!cubeName) { return; }
  const cfg = getServerConfig(node.meta.serverId as string);
  if (!cfg) { return; }
  await CubeViewerManager.open(cubeName, cfg, undefined, undefined, buildMdxTemplate(cubeName));
  vscode.window.showInformationMessage(
    vscode.l10n.t('Cube viewer opened — click "MDX", edit the query, then "Save as new MDX view…".'),
  );
}
