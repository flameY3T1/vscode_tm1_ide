import * as os from 'os';
import * as vscode from 'vscode';
import {
  showServerManagerCommand, getAllServers, getServerConfig, connect, disconnect,
  _connectFailureMessage, isTlsCertError, acceptCertificate, needsInitialCredentials, loadCredentials, deleteServer,
  saveServers, newServerId, isConnected, onServerChanged,
} from '../commands/serverManager';
import { toExportFile, mergeImport } from '../commands/serverManager/serverExchangePure';
import { confirmDowngradeModal } from '../commands/serverManager/probeConnection';
import { classifyInsecureSave } from '../commands/serverManager/form';
import { errMsg } from '../utils/errMsg';
import { registerImpersonationUi } from '../commands/serverManager/impersonationUi';
import { registerSessionStatus } from '../commands/serverManager/sessionStatus';
import { openServerConfigEditor } from '../commands/serverConfig/serverConfigEditor';
import { openAddServerPanel, openEditServerPanel, openAddAdminServerPanel } from '../commands/serverConfig/addServerPanel';
import { manageV12Databases } from '../commands/serverConfig/v12ManageDatabases';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { wrap } from './wrap';
import type { ActivationContext } from './context';

/**
 * Registers server connection commands:
 *   tm1.selectServer / server.connect / server.disconnect / server.refresh / server.openConfig
 */
export function registerServerCommands(ctx: ActivationContext): void {
  const { context, treeDataProvider } = ctx;

  registerImpersonationUi(context);
  registerSessionStatus(context, (id, idle) => treeDataProvider.setSessionIdle(id, idle));

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.selectServer', () => showServerManagerCommand(context)),
    vscode.commands.registerCommand('tm1.addServer', () => openAddServerPanel(context)),
    vscode.commands.registerCommand('tm1.server.exportList', async () => {
      const file = toExportFile(getAllServers(context), isConnected);
      // A bare `Uri.file('tm1-servers.json')` points at the filesystem root.
      const dir = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(dir, 'tm1-servers.json'),
        filters: { JSON: ['json'] },
      });
      if (!uri) { return; }
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(file, null, 2), 'utf8'));
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Server export failed — {0}', errMsg(err)));
        return;
      }
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: {0} servers exported (without usernames and passwords).', file.servers.length));
    }),
    vscode.commands.registerCommand('tm1.server.importList', async () => {
      const [uri] = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json'] } }) ?? [];
      if (!uri) { return; }
      try {
        const raw = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
        const result = mergeImport(getAllServers(context), raw, newServerId);
        // The server form asks before saving an insecure profile; an imported
        // team file must not skip that question.
        const insecure = result.servers.slice(result.servers.length - result.added)
          .filter(s => classifyInsecureSave(s) !== 'none');
        if (insecure.length > 0) {
          const IMPORT = vscode.l10n.t('Import');
          const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('{0} of the servers in this file connect insecurely (plain HTTP or certificate verification disabled), so credentials can be read: {1}. Import anyway?',
              insecure.length, insecure.map(s => s.name).join(', ')),
            { modal: true }, IMPORT);
          if (choice !== IMPORT) { return; }
        }
        if (result.added > 0) {
          await saveServers(context, result.servers);
          onServerChanged.fire('profiles');
        }
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: {0} servers imported, {1} already present. Credentials are asked on first connect.', result.added, result.skipped));
        if (result.invalid > 0) {
          vscode.window.showWarningMessage(vscode.l10n.t('TM1: {0} entries in the server list were invalid and ignored.', result.invalid));
        }
      } catch (err) {
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Server import failed — {0}', errMsg(err)));
      }
    }),
    vscode.commands.registerCommand('tm1.adminServer.add', () => openAddAdminServerPanel(context)),
    vscode.commands.registerCommand('tm1.editServer', (node?: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string | undefined;
      if (!serverId) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No server selected.')); return; }
      return openEditServerPanel(context, serverId);
    }),
    vscode.commands.registerCommand('tm1.server.connect', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      if (!serverId) { return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      if (!profile) { return; }
      // loadCredentials is the only way a connection gets its
      // credentials. A broken credential-set reference is treated here like
      // "no credentials yet" — the same server form helps in
      // both cases.
      const cred = await loadCredentials(context, profile);
      if (!cred.ok || needsInitialCredentials(profile, cred.password)) {
        await openEditServerPanel(context, profile.id);
        return;
      }
      try {
        await connect(context, profile);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Connected to "{0}"', profile.name));
      } catch (err) {
        const editLabel = vscode.l10n.t('Edit Server');
        // On a certificate error, shorten the path: otherwise the user would have to
        // open the form, find the checkbox and connect again. The
        // button states explicitly that the check is permanently off for this
        // profile — so switching it off remains a deliberate action.
        const acceptLabel = vscode.l10n.t('Accept certificate permanently and connect');
        const offerAccept = isTlsCertError(err) && profile.rejectUnauthorized !== false;
        const labels = offerAccept ? [acceptLabel, editLabel] : [editLabel];
        const choice = await vscode.window.showErrorMessage(
          _connectFailureMessage(err, profile.name), ...labels);
        if (choice === acceptLabel) {
          // Same MITM warning, modal, as the probe path and the server form.
          if (!await confirmDowngradeModal('tls', profile.serverUrl)) { return; }
          const updated = await acceptCertificate(context, serverId);
          if (!updated) { return; }
          try {
            await connect(context, updated);
            vscode.window.showInformationMessage(vscode.l10n.t('TM1: Connected to "{0}"', updated.name));
          } catch (err2) {
            vscode.window.showErrorMessage(_connectFailureMessage(err2, updated.name));
          }
        } else if (choice === editLabel) {
          await openEditServerPanel(context, serverId);
        }
      }
    }),
    vscode.commands.registerCommand('tm1.server.disconnect', async (node: Tm1TreeNode) => {
      const serverId = node?.meta?.serverId as string;
      if (!serverId) { return; }
      const profile = getAllServers(context).find(s => s.id === serverId);
      await disconnect(context, serverId);
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: Disconnected from "{0}"', profile?.name ?? serverId));
    }),
    vscode.commands.registerCommand('tm1.server.refresh', (node: Tm1TreeNode) => {
      treeDataProvider.refreshNode(node);
    }),
    vscode.commands.registerCommand('tm1.server.openConfig', wrap(vscode.l10n.t('Configuration'), async (node?: Tm1TreeNode) => {
      if (!node?.meta?.serverId) {
        vscode.window.showWarningMessage(vscode.l10n.t('Select a connected server.'));
        return;
      }
      const cfg = getServerConfig(node.meta.serverId);
      if (!cfg) { return; }
      const serverName = node.label?.toString() ?? node.meta.serverId;
      await openServerConfigEditor(cfg, serverName, context.extensionUri);
    })),
    vscode.commands.registerCommand('tm1.server.v12ManageDatabases', (node?: Tm1TreeNode) => manageV12Databases(node)),
    vscode.commands.registerCommand('tm1.server.editById', (serverId: string) => openEditServerPanel(context, serverId)),
    /**
     * "Delete server" on the server node. Previously deleting was only reachable via the button
     * in the server form.
     *
     * A server discovered from an admin server is DELIBERATELY not put on
     * its hide list (user's decision): the next expand finds it again
     * and creates an empty profile.
     */
    vscode.commands.registerCommand('tm1.server.delete', async (node?: Tm1TreeNode, selection?: Tm1TreeNode[]) => {
      // The context menu offers it only for a multi-selection (`listMultiSelection`)
      // and passes the whole selection; the edit form passes a single node.
      const ids = (selection?.length ? selection : node ? [node] : [])
        .map(n => n?.meta?.serverId as string | undefined)
        .filter((id): id is string => !!id);
      if (!ids.length) { vscode.window.showWarningMessage(vscode.l10n.t('TM1: No server selected.')); return; }
      const all = getAllServers(context);
      const profiles = ids.map(id => all.find(s => s.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
      if (!profiles.length) { return; }
      const DELETE = vscode.l10n.t('Delete');
      const answer = await vscode.window.showWarningMessage(
        profiles.length === 1
          ? vscode.l10n.t('Delete server "{0}"?', profiles[0].name)
          : vscode.l10n.t('Delete {0} servers: {1}?', profiles.length, profiles.map(p => p.name).join(', ')),
        {
          modal: true,
          detail: vscode.l10n.t('The profile and its stored credentials are removed from this machine. Nothing on the TM1 server is touched.'),
        },
        DELETE,
      );
      if (answer !== DELETE) { return; }
      // `deleteServer` first disconnects and then clears away the profile,
      // password, workbenches and attribute columns. One after the other: each
      // call rewrites the whole server list.
      // A failure on one profile must not leave the rest of the list standing.
      const failed: string[] = [];
      for (const p of profiles) {
        try { await deleteServer(context, p.id); } catch (err) { failed.push(`${p.name}: ${errMsg(err)}`); }
      }
      if (failed.length) {
        vscode.window.showErrorMessage(vscode.l10n.t('Could not delete: {0}', failed.join('; ')));
        return;
      }
      vscode.window.showInformationMessage(profiles.length === 1
        ? vscode.l10n.t('TM1: Server "{0}" deleted.', profiles[0].name)
        : vscode.l10n.t('TM1: {0} servers deleted.', profiles.length));
    }),
  );
}
