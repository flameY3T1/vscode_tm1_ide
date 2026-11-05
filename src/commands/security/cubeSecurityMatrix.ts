// src/commands/security/cubeSecurityMatrix.ts
// Manager + opener for CubeSecurityMatrix webview (all cubes × selected groups).

import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { getHtml } from './cubeSecurityMatrixWebview';
import { listGroups } from '../../security/api/groupsApi';
import { fetchAllCubePerms, updateCubePerms } from '../../security/api/cubeSecurityApi';
import { CubeViewerManager } from '../cubeViewer/manager';
import { detectMode } from '../../security/core/v12Adapter';
import type { CubePermLevel, PermLevel } from '../../security/types/permission';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/securityCubeMatrix/protocol';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { emptyOnMissingSecurityCube } from './securityCubeNotice';
import { postTo } from '../../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1.cubeSecurityMatrix', 'CubeSecurityMatrix');

export function initializeCubeSecurityMatrix(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

export function disposeAllCubeSecurityMatrix(): void {
  host.disposeAll();
}

export function disposeCubeSecurityMatrixForServer(serverId: string): void {
  host.disposePanelsForServer(serverId);
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

function cubeListFromPerms(perms: Record<string, Record<string, CubePermLevel>>): string[] {
  return Object.keys(perms).sort((a, b) => a.localeCompare(b));
}

export async function openCubeSecurityMatrix(serverId: string): Promise<void> {
  if (host.reveal(serverId)) return;

  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for serverId {0}', serverId));
    return;
  }

  host.open({
    key: serverId,
    title: `Cube Security: ${getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl}`,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        const [groups, perms, mode] = await Promise.all([
          listGroups(cfg),
          fetchAllCubePerms(cfg).catch(emptyOnMissingSecurityCube<Record<string, Record<string, CubePermLevel>>>()),
          detectMode(cfg),
        ]);
        post(panel, {
          type: 'init',
          cubes: cubeListFromPerms(perms),
          groups,
          perms,
          v12Mode: mode === 'v12',
        });
      } else if (msg.type === 'save') {
        // Group changes by cube; one updateCubePerms call per cube.
        const byCube = new Map<string, Array<{ group: string; level: PermLevel }>>();
        for (const ch of msg.changes) {
          let bucket = byCube.get(ch.cube);
          if (!bucket) {
            bucket = [];
            byCube.set(ch.cube, bucket);
          }
          bucket.push({ group: ch.group, level: ch.level });
        }
        const allOk: Array<{ cube: string; group: string }> = [];
        const allErrors: Array<{ cube: string; group: string; reason: string }> = [];
        const tasks = Array.from(byCube.entries()).map(async ([cubeName, changes]) => {
          try {
            const result = await updateCubePerms(cfg, cubeName, changes);
            for (const o of result.ok) allOk.push({ cube: cubeName, group: o.group });
            for (const e of result.errors) allErrors.push({ cube: cubeName, group: e.group, reason: e.reason });
          } catch (e) {
            const reason = errMsg(e);
            for (const ch of changes) allErrors.push({ cube: cubeName, group: ch.group, reason });
          }
        });
        await Promise.allSettled(tasks);
        post(panel, { type: 'saved', ok: allOk, errors: allErrors });
      } else if (msg.type === 'refresh') {
        const perms = await fetchAllCubePerms(cfg)
          .catch(emptyOnMissingSecurityCube<Record<string, Record<string, CubePermLevel>>>());
        post(panel, { type: 'refreshed', perms });
      } else if (msg.type === 'openView') {
        await CubeViewerManager.open('}CubeSecurity', cfg);
      }
    },
  });
}
