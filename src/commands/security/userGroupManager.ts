// src/commands/security/userGroupManager.ts
import * as vscode from 'vscode';
import { getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { getHtml } from './userGroupManagerWebview';
import { rememberColumnWidths } from '../../webviews/columnWidthStore';
import {
  listUsers, createUser, deleteUser, setPassword,
} from '../../security/api/usersApi';
import { listGroups, createGroup, deleteGroup } from '../../security/api/groupsApi';
import { getUserGroups, setUserGroups } from '../../security/api/membershipApi';
import { listClientAliasAttributes, fetchClientAliasValues } from '../../security/api/clientAliasApi';
import { detectMode } from '../../security/core/v12Adapter';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/securityUserGroup/protocol';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { keyedStore } from '../../utils/keyedStore';
import { USER_ALIAS_KEY } from '../../serverState/stateKeys';
import { postTo } from '../../webviews/typedPost';

const host = new WebviewPanelHost<WebviewToHost>('tm1.userGroupManager', 'UserGroupManager'); // keyed by serverId

/**
 * Remembered alias choice per server: `{ [serverId]: attributeName }`.
 *
 * Anyone who has once set, for CAM, under which attribute their users are
 * readable does not want to repeat that on every open.
 */
let _memento: vscode.Memento | undefined;

/** On the `utils/keyedStore` blueprint, so `purgeServerState` clears out the
 *  entry when the profile is deleted (previously it stayed behind,
 *  unreachable). The `Memento` here is not a whole `ExtensionContext` — the
 *  blueprint only wants a `globalState` field, which is what we pass through
 *  to it. */
const aliasStore = keyedStore<string>(USER_ALIAS_KEY, {
  ctx: () => (_memento ? { globalState: _memento } : undefined),
  normalize: (v) => (typeof v === 'string' ? v : ''),
  isEmpty: (v) => v === '',
});

/** Also read by the impersonation picker, so both show users the same way. */
export function storedAlias(serverId: string): string {
  return aliasStore.load(serverId);
}

async function rememberAlias(serverId: string, alias: string): Promise<void> {
  await aliasStore.save(serverId, alias);
}

export function initializeUserGroupManager(extensionUri: vscode.Uri, memento?: vscode.Memento): void {
  host.initialize(extensionUri);
  _memento = memento;
}

export function disposeAllUserGroupManager(): void {
  host.disposeAll();
}

export function disposeUserGroupManagerForServer(serverId: string): void {
  host.disposePanelsForServer(serverId);
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

export async function openUserGroupManager(serverId: string): Promise<void> {
  if (host.reveal(serverId)) return;

  const cfg = getServerConfig(serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server config not found for serverId {0}', serverId));
    return;
  }

  const panel = host.open({
    key: serverId,
    title: `TM1 Security Manager: ${getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl}`,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        const [users, groups, mode, aliasDefs] = await Promise.all([
          listUsers(cfg), listGroups(cfg), detectMode(cfg), listClientAliasAttributes(cfg),
        ]);
        // A remembered choice is only valid as long as the attribute still
        // exists — otherwise the bar would show an alias that delivers no
        // values.
        const alias = aliasDefs.includes(storedAlias(serverId)) ? storedAlias(serverId) : '';
        post(panel, {
          type: 'init', users, groups, v12Mode: mode === 'v12', aliasDefs, alias,
          self: cfg.username,
        });
        if (alias) {
          post(panel, { type: 'aliasValues', alias, values: await fetchClientAliasValues(cfg, alias) });
        }
      } else if (msg.type === 'setAlias') {
        await rememberAlias(serverId, msg.alias);
        const values = msg.alias ? await fetchClientAliasValues(cfg, msg.alias) : {};
        post(panel, { type: 'aliasValues', alias: msg.alias, values });
      } else if (msg.type === 'refresh') {
        const [users, groups] = await Promise.all([listUsers(cfg), listGroups(cfg)]);
        post(panel, { type: 'refreshed', users, groups });
      } else if (msg.type === 'createUser') {
        await createUser(cfg, msg.input);
        post(panel, { type: 'userCreated', user: { name: msg.input.name, type: msg.input.type, disabled: false, groups: msg.input.groups } });
      } else if (msg.type === 'deleteUser') {
        await deleteUser(cfg, msg.userName);
        post(panel, { type: 'userDeleted', userName: msg.userName });
      } else if (msg.type === 'impersonate') {
        // Post NOTHING to the panel after this call: starting impersonation
        // tears down all windows of this server, this one included. A `post`
        // afterward would be a "Webview is disposed".
        await vscode.commands.executeCommand(
          'tm1.impersonate.start', { meta: { serverId } }, msg.userName, msg.label);
      } else if (msg.type === 'setPassword') {
        await setPassword(cfg, msg.userName, msg.password);
        post(panel, { type: 'passwordSet', userName: msg.userName });
      } else if (msg.type === 'createGroup') {
        await createGroup(cfg, msg.name);
        post(panel, { type: 'groupCreated', group: { name: msg.name, isSystem: false, memberCount: 0 } });
      } else if (msg.type === 'deleteGroup') {
        await deleteGroup(cfg, msg.groupName);
        post(panel, { type: 'groupDeleted', groupName: msg.groupName });
      } else if (msg.type === 'saveMemberships') {
        // Group the per-edge add/remove ops by user, then write each affected
        // user's FULL group set in one PATCH (Groups@odata.bind). The per-edge
        // Groups/$ref POST returned 2xx on some TM1 builds without persisting
        // ("green but the tick vanishes after refresh"); the full-set PATCH is
        // the reliable, create-user-proven path. Fetch the user's current groups
        // first so we only touch what changed and don't drop untouched memberships.
        const byUser = new Map<string, { add: Set<string>; remove: Set<string> }>();
        for (const ch of msg.changes) {
          let e = byUser.get(ch.user);
          if (!e) { e = { add: new Set(), remove: new Set() }; byUser.set(ch.user, e); }
          if (ch.op === 'add') { e.add.add(ch.group); } else { e.remove.add(ch.group); }
        }
        const results = await Promise.allSettled([...byUser.entries()].map(async ([user, ops]) => {
          const groups = new Set(await getUserGroups(cfg, user));
          ops.add.forEach(g => groups.add(g));
          ops.remove.forEach(g => groups.delete(g));
          await setUserGroups(cfg, user, [...groups]);
          return user;
        }));
        // Map per-user outcomes back to the per-change ok/errors shape the UI expects.
        const ok: Array<{ user: string; group: string; op: 'add' | 'remove' }> = [];
        const errors: Array<{ user: string; group: string; op: 'add' | 'remove'; reason: string }> = [];
        const users = [...byUser.keys()];
        results.forEach((r, i) => {
          const user = users[i];
          const userChanges = msg.changes.filter(c => c.user === user);
          if (r.status === 'fulfilled') {
            ok.push(...userChanges);
          } else {
            const reason = String((r.reason as Error).message ?? r.reason);
            errors.push(...userChanges.map(c => ({ ...c, reason })));
          }
        });
        post(panel, { type: 'membershipsSaved', ok, errors });
      }
    },
    onError: (reason, msg, panel) => {
      post(panel, { type: 'error', message: `${msg.type}: ${reason}` });
    },
  });
  if (panel) { rememberColumnWidths(panel, 'userGroupManager'); }
}
