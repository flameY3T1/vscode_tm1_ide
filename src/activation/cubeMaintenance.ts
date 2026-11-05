import * as vscode from 'vscode';
import { apiRequest } from '../tm1Client';
import { getServerConfig } from '../serverState/state';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { escapeTiLiteral } from '../utils/tiLiteral';
import { buildCubeMaintUrl, labelForAction, type CubeMaintAction } from '../cubeMaintenance/cubeMaintenance';
import { executeTransientProcess } from '../tm1Rest/transientProcess';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { errMsg } from '../utils/errMsg';
import { odataErrorMessage, parseJsonSafe } from '../tm1Rest/parseRest';
import type { ODataError } from '../tm1Rest/odataTypes';
import { isOk } from '../tm1Rest/httpError';

/**
 * Runs a cube-maintenance action (SaveData/Unload/Load).
 * Shows a modal confirm for destructive ops (e.g. Unload).
 */
/** True when the action went through — the caller updates the Load/Unload menu. */
export async function runCubeMaintenance(node: Tm1TreeNode, action: CubeMaintAction, confirm: boolean): Promise<boolean> {
  const cubeName = (node?.meta?.cubeName as string) ?? '';
  if (!cubeName) { return false; }
  const cfg = getServerConfig(node?.meta?.serverId);
  if (!cfg) { return false; }
  const label = vscode.l10n.t(labelForAction(action));

  if (confirm) {
    const runLabel = vscode.l10n.t('Run');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('{0}: "{1}" — continue?', label, cubeName),
      { modal: true, detail: action === 'Unload'
        ? vscode.l10n.t('Cube will be removed from server RAM. Active user sessions on this Cube may fail until the Cube is loaded again.')
        : '' },
      runLabel,
    );
    if (choice !== runLabel) { return false; }
  }

  try {
    if (action === 'SaveData') {
      // Menus already hide this on v12 (`cube-v12` contextValue); this guards the
      // other entry points. Live-verified on v12: `CubeSaveData` is not a TI
      // function there — the run aborts with "equal sign not found".
      if (cfg.version === 'v12') {
        vscode.window.showWarningMessage(
          vscode.l10n.t('{0} is not available on TM1 v12 — the TI function does not exist there (v12 persists data on its own).', 'CubeSaveData'));
        return false;
      }
      // TM1 OData has no `tm1.SaveData` action at cube level — we go
      // through a one-off TI helper (`CubeSaveData('<cube>');`).
      await runCubeSaveDataViaTI(cubeName, cfg);
    } else {
      const url = buildCubeMaintUrl(cubeName, action);
      const res = await apiRequest('POST', url, '{}', undefined, cfg);
      if (!isOk(res)) {
        const msg = odataErrorMessage(parseJsonSafe<ODataError>(res.body, {})) ?? `HTTP ${res.statusCode}`;
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0} failed — {1}', label, msg));
        return false;
      }
    }
    vscode.window.showInformationMessage(vscode.l10n.t('TM1: {0} — "{1}" succeeded.', label, cubeName));
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0} failed — {1}', label, errMsg(err)));
    return false;
  }
}

async function runCubeSaveDataViaTI(cubeName: string, cfg: Tm1Config): Promise<void> {
  // Runs inline via `POST ExecuteProcessWithReturn` — no `}VSCode_CubeSaveData`
  // object is left on the server. The name still labels the run in the message log.
  await executeTransientProcess(cfg, {
    name: '}VSCode_CubeSaveData',
    // TI literal position → TI escaper (not the OData key escaper): throws on
    // control characters/line breaks in the name instead of sending broken TI code.
    prolog: `CubeSaveData('${escapeTiLiteral(cubeName)}');`,
  });
}
