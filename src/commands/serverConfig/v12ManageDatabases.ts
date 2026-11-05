// src/commands/serverConfig/v12ManageDatabases.ts
// "Manage Databases (Root)" flow for a connected TM1 v12 server: prompts the
// transient Root client credentials (management plane), then a QuickPick loop
// to list / create / delete databases. Root creds are never persisted.
import * as vscode from 'vscode';
import { getServerProfile } from '../serverManager';
import {
  listInstances, listDatabases, createDatabase, deleteDatabase, type RootCreds,
} from '../../tm1Rest/managementApi';
import { errMsg } from '../../utils/errMsg';

const t = vscode.l10n.t;

export async function manageV12Databases(node?: { meta?: { serverId?: string } }): Promise<void> {
  const serverId = node?.meta?.serverId;
  if (!serverId) { return; }
  const profile = getServerProfile(serverId);
  if (!profile) { return; }
  if (profile.version !== 'v12') {
    void vscode.window.showWarningMessage(t('Database management is only available for TM1 v12 servers.'));
    return;
  }

  const clientId = await vscode.window.showInputBox({
    title: t('Manage Databases — Root Client ID'),
    prompt: t('Root clientID from root-creds.json (management plane, not the App-Client)'),
    ignoreFocusOut: true,
  });
  if (!clientId) { return; }
  const clientSecret = await vscode.window.showInputBox({
    title: t('Manage Databases — Root Client Secret'),
    password: true,
    ignoreFocusOut: true,
  });
  if (clientSecret === undefined) { return; }

  const root: RootCreds = {
    serverUrl: profile.serverUrl,
    clientId,
    clientSecret,
    rejectUnauthorized: profile.rejectUnauthorized,
  };

  // Resolve the instance (default from the profile; pick if several exist).
  let instance = profile.v12?.instance || 'tm1';
  try {
    const insts = await listInstances(root);
    if (insts.length === 0) {
      void vscode.window.showErrorMessage(t('No instances found — check the root credentials / permissions.'));
      return;
    }
    if (insts.length === 1) {
      instance = insts[0].name;
    } else {
      const pick = await vscode.window.showQuickPick(insts.map(i => i.name), { title: t('Instance'), ignoreFocusOut: true });
      if (!pick) { return; }
      instance = pick;
    }
  } catch (err) {
    void vscode.window.showErrorMessage(t('Management API failed: {0}', errMsg(err)));
    return;
  }

  const CREATE = t('$(add) Create new database…');
  // Loop until the user dismisses the picker.
  for (;;) {
    let dbs: string[];
    try {
      dbs = await listDatabases(root, instance);
    } catch (err) {
      void vscode.window.showErrorMessage(t('Management API failed: {0}', errMsg(err)));
      return;
    }
    const items = [CREATE, ...dbs.map(d => `$(database) ${d}`)];
    const pick = await vscode.window.showQuickPick(items, {
      title: t('v12 Databases — {0} ({1})', instance, dbs.length),
      ignoreFocusOut: true,
    });
    if (!pick) { return; }

    if (pick === CREATE) {
      const name = await vscode.window.showInputBox({
        title: t('New database — name'),
        ignoreFocusOut: true,
        validateInput: (v) => v.trim() ? undefined : t('Name must not be empty.'),
      });
      if (!name || !name.trim()) { continue; }
      try {
        await createDatabase(root, instance, name.trim());
        void vscode.window.showInformationMessage(t('Database "{0}" created.', name.trim()));
      } catch (err) {
        void vscode.window.showErrorMessage(t('Create failed: {0}', errMsg(err)));
      }
      continue;
    }

    const db = pick.replace('$(database) ', '');
    const confirm = await vscode.window.showWarningMessage(
      t('Permanently delete database "{0}"?', db),
      { modal: true },
      t('Delete'),
    );
    if (confirm === t('Delete')) {
      try {
        await deleteDatabase(root, instance, db);
        void vscode.window.showInformationMessage(t('Database "{0}" deleted.', db));
      } catch (err) {
        void vscode.window.showErrorMessage(t('Delete failed: {0}', errMsg(err)));
      }
    }
  }
}
