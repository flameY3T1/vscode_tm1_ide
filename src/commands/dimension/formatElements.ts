import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { defaultHierarchyName, hasFormatAttribute, writeElementFormats, FORMAT_ATTR } from '../../tm1Rest/elementFormatApi';
import { escapeMdx } from '../../utils/odataKey';
import { attrCubeName } from './attrCube';
import { CubeViewerManager } from '../cubeViewer/manager';
import { errMsg } from '../../utils/errMsg';

/**
 * The query behind "Format elements…": every element of the dimension in
 * hierarchy order against the `Format` attribute. In that grid, "Format…" on
 * the Format cells edits the stored element formats (see `formatDialog.ts`,
 * attribute-cube mode).
 */
export function formatElementsMdx(dimName: string, hierName: string = dimName): string {
  const d = escapeMdx(dimName);
  const h = escapeMdx(hierName);
  const a = escapeMdx(attrCubeName(dimName));
  return `SELECT {[${a}].[${a}].[${escapeMdx(FORMAT_ATTR)}]} ON COLUMNS,\n`
    + `{HIERARCHIZE(TM1SUBSETALL([${d}].[${h}]))} ON ROWS\nFROM [${a}]`;
}

export async function formatElementsCommand(dimName: string, cfg: Tm1Config): Promise<void> {
  try {
    // The dimension's default hierarchy need not carry its name (`[a].[a]` then 404s).
    const hierName = await defaultHierarchyName(cfg, dimName);
    if (!(await hasFormatAttribute(cfg, dimName, hierName))) {
      const create = vscode.l10n.t('Create attribute');
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('Dimension "{0}" has no "Format" attribute. Create it on the server? It holds the number format TM1 uses for each element.', dimName),
        { modal: true }, create,
      );
      if (pick !== create) { return; }
      await writeElementFormats(cfg, dimName, {}, hierName);
    }
    await CubeViewerManager.open(attrCubeName(dimName), cfg, undefined, undefined, formatElementsMdx(dimName, hierName), true);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: Format elements failed: {0}', errMsg(err)));
  }
}
