// src/commands/security/elementSecurity.ts
import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { getHtml } from './elementSecurityWebview';
import { listGroups } from '../../security/api/groupsApi';
import { fetchElementPerms, updateElementPerms, cubeExists, createElementSecurityCube } from '../../security/api/elementSecurityApi';
import { CubeViewerManager } from '../cubeViewer/manager';
import { detectMode } from '../../security/core/v12Adapter';
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/securityElement/protocol';
import { errMsg } from '../../utils/errMsg';
import { parseBody } from '../../tm1Rest/parseRest';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { encodeODataKey } from '../../utils/odataKey';
import { postTo } from '../../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1.elementSecurity', 'ElementSecurity');

function panelKey(serverId: string, dimName: string): string {
  return `${serverId}::${dimName}`;
}

export function initializeElementSecurity(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

export function disposeAllElementSecurity(): void {
  host.disposeAll();
}

export function disposeElementSecurityForServer(serverId: string): void {
  host.disposePanelsForServer(serverId);
}

async function listDefaultHier(_cfg: Tm1Config, dimName: string): Promise<string> {
  // TM1 default hier always shares dim name in single-hier dims; for multi-hier dims still use dim-name as default
  return dimName;
}

async function listElementNames(cfg: Tm1Config, dimName: string, hierName: string): Promise<string[]> {
  // URL path keys: quote-doubling AND percent-encoding. A `/` in a dim/hier name
  // would otherwise split the path into an extra segment (WHATWG `new URL()`
  // repairs `}`/space but never `/` or `#`).
  const res = await apiRequest(
    'GET',
    `Dimensions('${encodeODataKey(dimName)}')/Hierarchies('${encodeODataKey(hierName)}')/Elements?$select=Name`,
    undefined, undefined, cfg,
  );
  assertOk(res, 'listElementNames');
  const parsed = parseBody<{ value: Array<{ Name: string }> }>(res);
  return parsed.value.map(e => e.Name);
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

export async function openElementSecurity(serverId: string, dimName: string): Promise<void> {
  if (!dimName) return;

  const key = panelKey(serverId, dimName);
  if (host.reveal(key)) return;

  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for serverId {0}', serverId));
    return;
  }

  host.open({
    key,
    title: `Element Security: ${dimName} (${getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl})`,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        const exists = await cubeExists(cfg, `}ElementSecurity_${dimName}`);
        if (!exists) {
          post(panel, { type: 'notFound', dimName, message: vscode.l10n.t("Element Security cube for '{0}' is missing.", dimName) });
          return;
        }
        const hierName = await listDefaultHier(cfg, dimName);
        const [groups, elements, perms, mode] = await Promise.all([
          listGroups(cfg),
          listElementNames(cfg, dimName, hierName),
          fetchElementPerms(cfg, dimName),
          detectMode(cfg),
        ]);
        post(panel, {
          type: 'init',
          dimName,
          hierName,
          elements,
          groups,
          perms,
          v12Mode: mode === 'v12',
        });
      } else if (msg.type === 'createCube') {
        try {
          await createElementSecurityCube(cfg, dimName);
        } catch (e) {
          const reason = errMsg(e);
          post(panel, { type: 'createError', message: reason });
          return;
        }
        const hierName = await listDefaultHier(cfg, dimName);
        const [groups, elements, perms, mode] = await Promise.all([
          listGroups(cfg),
          listElementNames(cfg, dimName, hierName),
          fetchElementPerms(cfg, dimName),
          detectMode(cfg),
        ]);
        post(panel, {
          type: 'init',
          dimName,
          hierName,
          elements,
          groups,
          perms,
          v12Mode: mode === 'v12',
        });
      } else if (msg.type === 'save') {
        const result = await updateElementPerms(cfg, dimName, msg.changes);
        post(panel, { type: 'saved', ok: result.ok, errors: result.errors });
      } else if (msg.type === 'refresh') {
        const perms = await fetchElementPerms(cfg, dimName);
        post(panel, { type: 'refreshed', perms });
      } else if (msg.type === 'openView') {
        await CubeViewerManager.open(`}ElementSecurity_${dimName}`, cfg);
      }
    },
  });
}
