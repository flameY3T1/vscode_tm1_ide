// src/commands/serverManager/impersonationUi.ts
// UI for view impersonation: two commands and the status bar display. The
// mechanics live in `impersonation.ts`.
import * as vscode from 'vscode';
import { listUsers } from '../../security/api/usersApi';
import { listClientAliasAttributes, fetchClientAliasValues } from '../../security/api/clientAliasApi';
import { storedAlias } from '../security/userGroupManager';
import { getServerConfig, getAllServers, onServerChanged } from '../../serverState/state';
import { getImpersonation, listImpersonations, setImpersonation } from './impersonation';

/** A server's display name, otherwise its id. */
function serverLabel(ctx: vscode.ExtensionContext, serverId: string): string {
  return getAllServers(ctx).find(s => s.id === serverId)?.name ?? serverId;
}

/**
 * The status bar entry is created ONLY once the first impersonation starts.
 * This not only saves a control that would be hidden most of the time — it
 * also keeps `vscode.StatusBarAlignment` out of the startup path, which
 * several tests run through with a thin vscode stub.
 */
let _item: vscode.StatusBarItem | undefined;

function ensureItem(): vscode.StatusBarItem {
  if (!_item) {
    _item = vscode.window.createStatusBarItem('tm1.impersonation', vscode.StatusBarAlignment.Left, 0);
    _item.name = vscode.l10n.t('TM1 Impersonation');
    // Warning color, not error color: the impersonation is intentional, but
    // it must not go unnoticed — forgetting about it means mistaking someone
    // else's rights for your own.
    _item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    _item.command = 'tm1.impersonate.stop';
  }
  return _item;
}

/**
 * Readable label per server for the impersonated user (CAM alias), set when
 * the impersonation starts. Display only — `impersonate` keeps the real name.
 */
const _labels = new Map<string, { user: string; label: string }>();

function shownUser(serverId: string, user: string): string {
  const l = _labels.get(serverId);
  return l && l.user === user ? l.label : user;
}

function updateStatusBar(ctx: vscode.ExtensionContext): void {
  const active = listImpersonations();
  // `tm1.impersonating` controls ONLY the command palette — there is no
  // `viewItem` there that a single server could be recognized by.
  //
  // The context menu, by contrast, hangs off the `-imp` marker in the node
  // id (`providers/tm1TreeNodes.ts`), so it is precise per server. Until
  // 2026-09-20 this comment said the opposite — it described a discarded
  // design and would have led the next reader to strip the marker back out
  // as menu-breaking. Guard: `serverRootMenuWhenClauses.test.ts`.
  void vscode.commands.executeCommand('setContext', 'tm1.impersonating', active.length > 0);
  if (active.length === 0) { _item?.hide(); return; }
  const item = ensureItem();
  if (active.length === 1) {
    item.text = `$(eye) ${shownUser(active[0].serverId, active[0].user)}`;
    item.tooltip = vscode.l10n.t('Viewing TM1 as "{0}" on "{1}" — click to stop.',
      shownUser(active[0].serverId, active[0].user), serverLabel(ctx, active[0].serverId));
  } else {
    item.text = vscode.l10n.t('$(eye) {0} impersonations', String(active.length));
    item.tooltip = active
      .map(a => vscode.l10n.t('"{0}" on "{1}"', shownUser(a.serverId, a.user), serverLabel(ctx, a.serverId)))
      .join('\n');
  }
  item.show();
}

/**
 * CAM user names are directory identifiers; only a `}Clients` alias is
 * readable. Takes the alias chosen in the security manager, otherwise the
 * first alias attribute (on CAM servers usually `}TM1_DefaultDisplayValue`).
 */
async function aliasValues(cfg: NonNullable<ReturnType<typeof getServerConfig>>, serverId: string): Promise<Record<string, string>> {
  const alias = storedAlias(serverId) || (await listClientAliasAttributes(cfg))[0];
  return alias ? fetchClientAliasValues(cfg, alias) : {};
}

async function pickUser(cfg: ReturnType<typeof getServerConfig>, serverId: string): Promise<{ user: string; label: string } | undefined> {
  if (!cfg) { return undefined; }
  const [users, alias] = await Promise.all([listUsers(cfg), aliasValues(cfg, serverId)]);
  const items: Array<vscode.QuickPickItem & { user: string }> = users
    // Impersonating yourself is a no-op that looks like a failure: nothing
    // changes, but the windows close anyway.
    .filter(u => u.name.toLowerCase() !== cfg.username.toLowerCase())
    .map(u => {
      const shown = alias[u.name];
      const groups = u.disabled ? vscode.l10n.t('disabled') : u.groups.join(', ');
      // The label is display only; `user` stays the real name the server needs.
      return shown && shown !== u.name
        ? { label: shown, description: u.name, detail: groups, user: u.name }
        : { label: u.name, description: groups, user: u.name };
    });
  if (items.length === 0) { return undefined; }
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Select the user whose view of TM1 you want to see'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return pick ? { user: pick.user, label: pick.label } : undefined;
}

export function registerImpersonationUi(context: vscode.ExtensionContext): void {
  const refresh = (): void => updateStatusBar(context);

  context.subscriptions.push(
    { dispose: () => { _item?.dispose(); _item = undefined; } },
    // `onServerChanged` fires on every change — including from
    // `setImpersonation` itself, so the command doesn't need to refresh the
    // display by hand.
    onServerChanged.event(refresh),

    // Second argument: the user is already known. This lets the security
    // manager call in from its user list without a second path into
    // impersonation being created there.
    vscode.commands.registerCommand('tm1.impersonate.start', async (
      node?: { meta?: { serverId?: string } }, presetUser?: string, presetLabel?: string,
    ) => {
      const serverId = node?.meta?.serverId;
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!serverId || !cfg) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server not connected.'));
        return;
      }
      try {
        const pick = presetUser
          ? { user: presetUser, label: presetLabel || presetUser }
          : await pickUser(cfg, serverId);
        if (!pick) { return; }
        // Before setImpersonation: its change event already redraws the status bar.
        _labels.set(serverId, pick);
        await setImpersonation(context, serverId, pick.user);
        vscode.window.showInformationMessage(vscode.l10n.t(
          'Now viewing TM1 as "{0}". Open windows were closed — reopen them to see this user\'s view.', pick.label));
      } catch (err) {
        vscode.window.showErrorMessage((err as Error)?.message ?? String(err));
      }
    }),

    vscode.commands.registerCommand('tm1.impersonate.stop', async (node?: { meta?: { serverId?: string } }) => {
      const active = listImpersonations();
      if (active.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No impersonation is active.'));
        return;
      }
      let serverId = node?.meta?.serverId;
      if (!serverId || !getImpersonation(serverId)) {
        serverId = active.length === 1
          ? active[0].serverId
          : (await vscode.window.showQuickPick(
              active.map(a => ({ label: shownUser(a.serverId, a.user), description: serverLabel(context, a.serverId), id: a.serverId })),
              { placeHolder: vscode.l10n.t('End which impersonation?') },
            ))?.id;
      }
      if (!serverId) { return; }
      const was = getImpersonation(serverId);
      const wasShown = was ? shownUser(serverId, was) : '';
      try {
        await setImpersonation(context, serverId, undefined);
        vscode.window.showInformationMessage(
          vscode.l10n.t('Impersonation of "{0}" ended.', wasShown));
        _labels.delete(serverId);
      } catch (err) {
        vscode.window.showErrorMessage((err as Error)?.message ?? String(err));
      }
    }),
  );
  refresh();
}
