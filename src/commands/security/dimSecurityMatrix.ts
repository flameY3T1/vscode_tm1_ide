// src/commands/security/dimSecurityMatrix.ts
// Manager + opener for DimSecurityMatrix webview (all dims × selected groups).

import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { getHtml } from './dimSecurityMatrixWebview';
import { listGroups } from '../../security/api/groupsApi';
import { fetchAllDimPerms, updateDimPerms } from '../../security/api/dimSecurityApi';
import { CubeViewerManager } from '../cubeViewer/manager';
import { detectMode } from '../../security/core/v12Adapter';
import type { DimPermLevel, PermLevel } from '../../security/types/permission';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/securityDimMatrix/protocol';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { emptyOnMissingSecurityCube } from './securityCubeNotice';
import { postTo } from '../../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1.dimSecurityMatrix', 'DimSecurityMatrix');

export function initializeDimSecurityMatrix(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

export function disposeAllDimSecurityMatrix(): void {
  host.disposeAll();
}

export function disposeDimSecurityMatrixForServer(serverId: string): void {
  host.disposePanelsForServer(serverId);
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

function dimListFromPerms(perms: Record<string, Record<string, DimPermLevel>>): string[] {
  return Object.keys(perms).sort((a, b) => a.localeCompare(b));
}

export async function openDimSecurityMatrix(serverId: string): Promise<void> {
  if (host.reveal(serverId)) return;

  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for serverId {0}', serverId));
    return;
  }

  host.open({
    key: serverId,
    title: `Dimension Security: ${getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl}`,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        const [groups, perms, mode] = await Promise.all([
          listGroups(cfg),
          fetchAllDimPerms(cfg).catch(emptyOnMissingSecurityCube<Record<string, Record<string, DimPermLevel>>>()),
          detectMode(cfg),
        ]);
        post(panel, {
          type: 'init',
          dims: dimListFromPerms(perms),
          groups,
          perms,
          v12Mode: mode === 'v12',
        });
      } else if (msg.type === 'save') {
        const byDim = new Map<string, Array<{ group: string; level: PermLevel }>>();
        for (const ch of msg.changes) {
          let bucket = byDim.get(ch.dim);
          if (!bucket) {
            bucket = [];
            byDim.set(ch.dim, bucket);
          }
          bucket.push({ group: ch.group, level: ch.level });
        }
        const allOk: Array<{ dim: string; group: string }> = [];
        const allErrors: Array<{ dim: string; group: string; reason: string }> = [];
        const tasks = Array.from(byDim.entries()).map(async ([dimName, changes]) => {
          try {
            const result = await updateDimPerms(cfg, dimName, changes);
            for (const o of result.ok) allOk.push({ dim: dimName, group: o.group });
            for (const e of result.errors) allErrors.push({ dim: dimName, group: e.group, reason: e.reason });
          } catch (e) {
            const reason = errMsg(e);
            for (const ch of changes) allErrors.push({ dim: dimName, group: ch.group, reason });
          }
        });
        await Promise.allSettled(tasks);
        post(panel, { type: 'saved', ok: allOk, errors: allErrors });
      } else if (msg.type === 'refresh') {
        const perms = await fetchAllDimPerms(cfg)
          .catch(emptyOnMissingSecurityCube<Record<string, Record<string, DimPermLevel>>>());
        post(panel, { type: 'refreshed', perms });
      } else if (msg.type === 'openView') {
        await CubeViewerManager.open('}DimensionSecurity', cfg);
      }
    },
  });
}
