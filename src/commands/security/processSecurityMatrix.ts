// src/commands/security/processSecurityMatrix.ts
// Manager + opener for ProcessSecurityMatrix webview (all processes × selected groups).

import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { getHtml } from './processSecurityMatrixWebview';
import { listGroups } from '../../security/api/groupsApi';
import { fetchAllProcessPerms, updateProcessPerms } from '../../security/api/processSecurityApi';
import { CubeViewerManager } from '../cubeViewer/manager';
import { detectMode } from '../../security/core/v12Adapter';
import type { ProcessPermLevel, PermLevel } from '../../security/types/permission';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/securityProcessMatrix/protocol';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { emptyOnMissingSecurityCube } from './securityCubeNotice';
import { postTo } from '../../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1.processSecurityMatrix', 'ProcessSecurityMatrix');

export function initializeProcessSecurityMatrix(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

export function disposeAllProcessSecurityMatrix(): void {
  host.disposeAll();
}

export function disposeProcessSecurityMatrixForServer(serverId: string): void {
  host.disposePanelsForServer(serverId);
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

function processListFromPerms(perms: Record<string, Record<string, ProcessPermLevel>>): string[] {
  return Object.keys(perms).sort((a, b) => a.localeCompare(b));
}

export async function openProcessSecurityMatrix(serverId: string): Promise<void> {
  if (host.reveal(serverId)) return;

  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for serverId {0}', serverId));
    return;
  }

  host.open({
    key: serverId,
    title: `Process Security: ${getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl}`,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        const [groups, perms, mode] = await Promise.all([
          listGroups(cfg),
          fetchAllProcessPerms(cfg).catch(emptyOnMissingSecurityCube<Record<string, Record<string, ProcessPermLevel>>>()),
          detectMode(cfg),
        ]);
        post(panel, {
          type: 'init',
          processes: processListFromPerms(perms),
          groups,
          perms,
          v12Mode: mode === 'v12',
        });
      } else if (msg.type === 'save') {
        const byProc = new Map<string, Array<{ group: string; level: PermLevel }>>();
        for (const ch of msg.changes) {
          let bucket = byProc.get(ch.process);
          if (!bucket) {
            bucket = [];
            byProc.set(ch.process, bucket);
          }
          bucket.push({ group: ch.group, level: ch.level });
        }
        const allOk: Array<{ process: string; group: string }> = [];
        const allErrors: Array<{ process: string; group: string; reason: string }> = [];
        const tasks = Array.from(byProc.entries()).map(async ([procName, changes]) => {
          try {
            const result = await updateProcessPerms(cfg, procName, changes);
            for (const o of result.ok) allOk.push({ process: procName, group: o.group });
            for (const e of result.errors) allErrors.push({ process: procName, group: e.group, reason: e.reason });
          } catch (e) {
            const reason = errMsg(e);
            for (const ch of changes) allErrors.push({ process: procName, group: ch.group, reason });
          }
        });
        await Promise.allSettled(tasks);
        post(panel, { type: 'saved', ok: allOk, errors: allErrors });
      } else if (msg.type === 'refresh') {
        const perms = await fetchAllProcessPerms(cfg)
          .catch(emptyOnMissingSecurityCube<Record<string, Record<string, ProcessPermLevel>>>());
        post(panel, { type: 'refreshed', perms });
      } else if (msg.type === 'openView') {
        await CubeViewerManager.open('}ProcessSecurity', cfg);
      }
    },
  });
}
