import * as vscode from 'vscode';
import type { ActivationContext } from './context';
import {
  getAdminServer, hideDiscovered, unhideDiscovered,
} from '../serverState/adminServers';
import { removeAdminServerWithChildren } from '../commands/serverManager/adminRemove';
import { getAllServers, saveServers, onServerChanged, type ServerProfile } from '../serverState/state';
import { listServerFolders, createServerFolder, setServerFolder } from '../serverState/profiles';
import { openEditAdminServerPanel } from '../commands/serverConfig/addServerPanel';
import { deleteServer } from '../commands/serverManager/form';
import { describeInstanceListError, listInstancesFor } from '../providers/adminInstances';
import { discoveredProfileId } from '../providers/adminDiscoveryPure';
import { showTm1TopForAdminCommand } from '../commands/tm1Top';
import type { Tm1TreeNode } from '../providers/tm1TreeNodes';

/**
 * Registers the TM1 Admin Server node commands: refresh, edit, remove,
 * restore, and "take an instance out of the admin server" (detach).
 *
 * `tm1.adminServer.add` (the add-dialog) is registered separately in Task 7.
 */
export function registerAdminServerCommands(ac: ActivationContext): void {
  const { context } = ac;

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.adminServer.refresh', () => {
      // Discovery is tied to the expand — refreshing the tree is enough to
      // trigger it again on the next expand.
      onServerChanged.fire('profiles');
    }),

    vscode.commands.registerCommand('tm1.adminServer.tm1Top', (node: Tm1TreeNode) => showTm1TopForAdminCommand(context, node)),

    vscode.commands.registerCommand('tm1.adminServer.edit', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      if (!adminId) { return; }
      // Same edit view as "Edit server" — two bare input lines were the only
      // break in an otherwise uniform path (adding has long gone through the
      // same form, kind "admin"). Whether the entry still exists is checked
      // and REPORTED by the panel; a second check here would be a silent
      // branch in front of it (review 2026-08-28,
      // finding 4).
      await openEditAdminServerPanel(context, adminId);
    }),

    vscode.commands.registerCommand('tm1.adminServer.remove', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      if (!adminId) { return; }
      // The confirmation and sparing the children live in `adminRemove.ts`,
      // because the delete button of the edit view takes the same path.
      await removeAdminServerWithChildren(context, adminId);
    }),
    // Second id, same body: the label is static in package.json, and
    // "Edit admin server" read wrong under a PAW gateway (reported
    // 2026-09-16). The menu conditions separate the two kinds; guard:
    // src/test/adminServerInlineMenu.test.ts.
    vscode.commands.registerCommand('tm1.adminServer.editPaw', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      if (!adminId) { return; }
      // Same edit view as "Edit server" — two bare input lines were the only
      // break in an otherwise uniform path (adding has long gone through the
      // same form, kind "admin"). Whether the entry still exists is checked
      // and REPORTED by the panel; a second check here would be a silent
      // branch in front of it (review 2026-08-28,
      // finding 4).
      await openEditAdminServerPanel(context, adminId);
    }),
    vscode.commands.registerCommand('tm1.adminServer.removePaw', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      if (!adminId) { return; }
      // The confirmation and sparing the children live in `adminRemove.ts`,
      // because the delete button of the edit view takes the same path.
      await removeAdminServerWithChildren(context, adminId);
    }),

    /**
     * Hide instances permanently — the counterpart to `restore`.
     *
     * `detach` is NOT the same: it takes an instance out of the group and
     * puts it into the root area or a folder, so it stays visible. Whoever
     * wanted to get rid of it had to delete it afterwards — and
     * `deleteServer` does not touch `hidden`, the next discovery would
     * promptly create it again. With a gateway holding thirty databases this
     * is the difference between usable and unusable (reported 2026-09-16).
     *
     * Multi-select like `restore`, so that both directions are operated
     * the same way.
     */
    vscode.commands.registerCommand('tm1.adminServer.hide', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      const admin = adminId ? getAdminServer(adminId) : undefined;
      if (!admin || !adminId) { return; }

      const candidates = getAllServers(context)
        .filter(s => s.parentAdminId === adminId && !!s.discoveredName);
      if (candidates.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('"{0}" currently shows no instances that could be hidden.', admin.name),
        );
        return;
      }

      const picks = await vscode.window.showQuickPick(
        candidates.map(s => ({
          label: s.discoveredName as string,
          description: s.name === s.discoveredName ? undefined : s.name,
          id: s.id,
        })),
        {
          canPickMany: true,
          placeHolder: vscode.l10n.t('Hide which instances of "{0}"?', admin.name),
        },
      );
      if (!picks || picks.length === 0) { return; }

      const HIDE = vscode.l10n.t('Hide instances');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Hide {0} instance(s) of "{1}"?', picks.length, admin.name),
        {
          modal: true,
          detail: vscode.l10n.t('The profiles and their stored credentials are removed from this machine, and discovery will not add them again. Nothing on the TM1 server is touched. Use "Take instances back into the group…" to undo this.'),
        },
        HIDE,
      );
      if (answer !== HIDE) { return; }

      // FIRST onto the list, THEN delete. `deleteServer` reports a
      // change, a discovery run triggered by that would immediately re-create
      // a profile that is not yet noted.
      for (const pick of picks) { await hideDiscovered(adminId, pick.label); }
      for (const pick of picks) { await deleteServer(context, pick.id); }

      vscode.window.showInformationMessage(
        vscode.l10n.t('TM1: {0} instance(s) hidden from "{1}".', picks.length, admin.name),
      );
    }),

    vscode.commands.registerCommand('tm1.adminServer.restore', async (node: Tm1TreeNode) => {
      const adminId = node?.meta?.adminId as string | undefined;
      const admin = adminId ? getAdminServer(adminId) : undefined;
      if (!admin || !adminId) { return; }
      const hidden = admin.hidden ?? [];
      if (hidden.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t('Nothing has been taken out of "{0}" yet.', admin.name),
        );
        return;
      }

      // Compare against the CURRENT state, not against the list from the
      // time of creation: `hidden` are mere names and age along. A database
      // that no longer exists on the gateway would be an offer here that
      // does nothing when accepted (reported 2026-09-16).
      //
      // The comparison only MARKS, it does not filter. What the server does
      // not currently report is not the same as "no longer exists": a
      // stopped instance does not count as reported here. Both calls return
      // it (`acceptingClients: false`) — but the tree filters it, so
      // a "will be rediscovered" would promise something that does not happen
      // until the next start. Whoever wants to take it back during the
      // downtime still needs the path — otherwise the name stays stuck in
      // `hidden` until the next start, without the dialog saying why it is empty.
      //
      // If the call fails completely, the column stays empty and we say so.
      let reported: Set<string> | undefined;
      try {
        const instances = await listInstancesFor(admin);
        reported = new Set(instances.filter(i => i.acceptingClients).map(i => i.name));
      } catch (err) {
        vscode.window.showWarningMessage(
          vscode.l10n.t('"{0}" could not be reached — the list below is not checked against it.', admin.name)
          + ' ' + describeInstanceListError(admin.kind, err, admin.serverUrl),
        );
      }

      // Fallback exact-id match first. The name-based fallback must never
      // steal a profile that belongs to a DIFFERENT admin server — including
      // one detached from it, which also has no `parentAdminId` but still
      // carries that admin's namespaced id (`disc:<otherAdminId>:<name>`).
      // Accept it only if its id sits in THIS admin's namespace, or if it
      // carries no `disc:`-namespaced id at all (a manually added server).
      const findProfile = (list: ServerProfile[], name: string) => (
        list.find(s => s.id === discoveredProfileId(adminId, name))
        ?? list.find(s => (
          s.discoveredName === name
          && !s.parentAdminId
          && (!s.id.startsWith('disc:') || s.id === discoveredProfileId(adminId, name))
        ))
      );

      const servers = getAllServers(context);
      const describe = (name: string): string => {
        // What the server does not report is stated above: taking it back would
        // lead nowhere as long as the instance stays down. This outranks the
        // note about the still existing profile — it is the reason why the entry
        // may achieve nothing.
        if (reported && !reported.has(name)) {
          return vscode.l10n.t('not currently reported by "{0}"', admin.name);
        }
        const profile = findProfile(servers, name);
        if (!profile) { return vscode.l10n.t('no longer exists — will be rediscovered fresh'); }
        return profile.folder
          ? vscode.l10n.t('still exists as "{0}" in folder "{1}"', profile.name, profile.folder)
          : vscode.l10n.t('still exists as "{0}"', profile.name);
      };
      // Reported ones first — the unreported ones are the special case and should
      // not stand between the usable rows. `localeCompare` keeps the
      // two groups each in the usual order.
      const sorted = reported
        ? [...hidden].sort((a, b) => (
          Number(!reported.has(a)) - Number(!reported.has(b)) || a.localeCompare(b)
        ))
        : hidden;
      const items: vscode.QuickPickItem[] = sorted.map(name => ({
        label: name,
        description: describe(name),
      }));

      const picks = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: vscode.l10n.t('Take which instances back into "{0}"?', admin.name),
      });
      if (!picks || picks.length === 0) { return; }

      // Persist the profile changes BEFORE touching `hidden` below —
      // `unhideDiscovered` fires `onServerChanged` per name, and a listener-
      // triggered refresh in between must not race a write built from a by
      // then stale snapshot.
      let next = getAllServers(context);
      for (const pick of picks) {
        const name = pick.label;
        const profile = findProfile(next, name);
        if (profile) {
          // One combined write (parentAdminId back + folder cleared) instead
          // of going through `setServerFolder`/`assignFolder` separately —
          // same effect, but a single `saveServers` instead of two.
          next = next.map(s => (
            s.id === profile.id ? { ...s, parentAdminId: adminId, folder: undefined } : s
          ));
        }
      }
      await saveServers(context, next);

      for (const pick of picks) {
        await unhideDiscovered(adminId, pick.label);
      }
    }),

    vscode.commands.registerCommand('tm1.adminServer.detach', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      if (!serverId) { return; }
      const server = getAllServers(context).find(s => s.id === serverId);
      if (!server?.parentAdminId) {
        // Since the `-adm` marker on the contextValue the menu entry exists ONLY
        // on discovered servers; so one gets here only via a call from
        // elsewhere (command palette, keyboard shortcut, other code).
        // The guard stays anyway — it costs nothing and explains
        // instead of silently doing nothing.
        vscode.window.showInformationMessage(
          vscode.l10n.t('This server does not come from an admin server.'),
        );
        return;
      }

      const NEW = vscode.l10n.t('$(new-folder) New Folder…');
      const NONE = vscode.l10n.t('$(circle-slash) No folder');
      const items: vscode.QuickPickItem[] = listServerFolders().map(f => ({ label: f }));
      items.push({ label: NEW }, { label: NONE });
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Take "{0}" out of the admin server and put it into…', server.name),
      });
      if (!pick) { return; }

      let folder: string | undefined;
      if (pick.label === NEW) {
        folder = (await vscode.window.showInputBox({ ignoreFocusOut: true, prompt: vscode.l10n.t('New folder name') }))?.trim();
        if (!folder) { return; }
        await createServerFolder(folder);
      } else if (pick.label !== NONE) {
        folder = pick.label;
      }

      // Read before the parentAdminId is cleared below — hideDiscovered needs
      // the name the admin server reports, not the (possibly renamed) display name.
      const adminId = server.parentAdminId;
      const discoveredName = server.discoveredName;
      await saveServers(context, getAllServers(context).map(s => (
        s.id === serverId ? { ...s, parentAdminId: undefined } : s
      )));
      await setServerFolder(serverId, folder);
      // Without this marker the next discovery would immediately recreate the
      // instance under the admin server.
      if (discoveredName) { await hideDiscovered(adminId, discoveredName); }
    }),
  );
}
