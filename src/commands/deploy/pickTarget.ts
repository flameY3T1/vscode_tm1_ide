// src/commands/deploy/pickTarget.ts
//
// Choose the TARGET server — the question every individual "deploy to
// another server" command asks first.
//
// Lives here and not per command, because otherwise every new kind (rule,
// chore, …) would write out the same list, the same label and the same
// "no other server connected" message once again.
import * as vscode from 'vscode';
import { getConnectedIds, getServerConfig, getServerNameByUrl } from '../../serverState/state';
import type { Tm1Config } from '../../tm1Rest/transport/types';

/** Profile name, else host:port, else the bare URL. */
export function pickServerLabel(serverUrl?: string, fallback = ''): string {
  if (!serverUrl) { return fallback; }
  const name = getServerNameByUrl(serverUrl);
  if (name) { return name; }
  try {
    const u = new URL(serverUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return serverUrl;
  }
}

export interface PickedTarget {
  id: string;
  label: string;
  cfg: Tm1Config;
}

/**
 * Choose one among the CONNECTED servers, excluding the source server.
 *
 * `undefined` means: nothing to do — either there is no target (in which
 * case the message has already gone out) or the user cancelled.
 */
export async function pickTargetServer(
  sourceServerId: string, title: string, placeHolder?: string,
): Promise<PickedTarget | undefined> {
  const targetIds = getConnectedIds().filter(id => id !== sourceServerId);
  if (targetIds.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('No other connected servers. Connect a target server first.'));
    return undefined;
  }

  type Item = vscode.QuickPickItem & { id: string };
  const items: Item[] = targetIds.map(id => {
    const cfg = getServerConfig(id);
    return { id, label: pickServerLabel(cfg?.serverUrl, id), description: cfg?.serverUrl };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: placeHolder ?? vscode.l10n.t('Select target server'),
  });
  if (!picked) { return undefined; }

  const cfg = getServerConfig(picked.id);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Target server configuration not found.'));
    return undefined;
  }
  return { id: picked.id, label: picked.label, cfg };
}
