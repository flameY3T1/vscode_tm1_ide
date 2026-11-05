import * as vscode from 'vscode';
import { getConfig } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getConnectedIdsRestored, getServerConfig } from '../../serverState/state';

/**
 * Returns the deploy target config.
 * If only one server is connected, returns it directly.
 * If multiple servers are connected, shows a QuickPick so the user can choose.
 * Returns undefined if the user cancels the QuickPick.
 */
export async function pickDeployTarget(): Promise<Tm1Config | undefined> {
  const ids = await getConnectedIdsRestored();
  if (ids.length === 0) { return getConfig(); }
  if (ids.length === 1) { return getServerConfig(ids[0]) ?? getConfig(); }

  type Item = vscode.QuickPickItem & { id: string };
  const items: Item[] = ids.map(id => {
    const cfg = getServerConfig(id);
    let label = id;
    if (cfg?.serverUrl) {
      try {
        const u = new URL(cfg.serverUrl);
        label = u.port ? `${u.hostname}:${u.port}` : u.hostname;
      } catch { label = cfg.serverUrl; }
    }
    return { label, description: cfg?.serverUrl, id };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Select deploy target'),
    placeHolder: vscode.l10n.t('Deploy to which TM1 server?'),
  });
  if (!picked) { return undefined; }
  return getServerConfig(picked.id);
}
