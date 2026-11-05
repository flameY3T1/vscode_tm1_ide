/**
 * The guard "is a server even connected?" — once instead of twelve times.
 *
 * Until 2026-08-29, twelve commands wrote the same two lines, in three
 * variants (`showErrorMessage`, `showWarningMessage`, `throw`), and all
 * twelve threw TWO different situations into one sentence. `confirmAndRun`
 * already distinguished them — as the only spot, out of a code review:
 *
 *   A tree node without `meta.serverId` is a wiring bug on our side; the
 *   server can be perfectly well connected in that case. `getServerConfig`
 *   simply finds nothing for `undefined` and would wrongly make the user
 *   doubt their connection.
 *
 * This helper carries the distinction into every call site — so the
 * refactor doesn't just save lines, it corrects twelve messages.
 */
import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { _ctx, getConnectedIdsRestored, getServer, getServerConfig, getServerNameByUrl } from './state';

/** The sentence for the situation, without showing it — for callers with their own channel. */
export function serverConfigError(serverId: string | undefined): string {
  return serverId
    ? vscode.l10n.t('TM1: No server connected.')
    : vscode.l10n.t('TM1: This entry carries no server reference — refresh the Explorer and try again.');
}

/**
 * Config for the `serverId`, or `undefined` — in which case the matching
 * message has already been shown and the caller bails out:
 *
 *     const cfg = requireServerConfig(node?.meta?.serverId);
 *     if (!cfg) { return; }
 */
export function requireServerConfig(serverId: string | undefined): Tm1Config | undefined {
  const cfg = serverId ? getServerConfig(serverId) : undefined;
  if (!cfg) { vscode.window.showErrorMessage(serverConfigError(serverId)); }
  return cfg;
}

/**
 * The same for callers that are already inside a `try` and report their
 * error via the `catch` — or that collect a failure per element in a loop
 * over several nodes (`tree/deleteViewsSubsets.ts`). There, a `return` would
 * be wrong: it would break the loop instead of marking the one entry as
 * failed.
 */
export function requireServerConfigOrThrow(serverId: string | undefined): Tm1Config {
  const cfg = serverId ? getServerConfig(serverId) : undefined;
  if (!cfg) { throw new Error(serverConfigError(serverId)); }
  return cfg;
}

/**
 * Server for a command that comes from the tree OR from a keyboard shortcut.
 *
 * With a tree node: its server, no confirmation needed. Without a node
 * (shortcut, command palette): with exactly one connected server that one,
 * with several a picker. `undefined` = nothing connected (message already
 * shown) or cancelled. `alwaysAsk` shows the picker even for a single
 * connected server — for callers where a silent choice could hit the wrong one.
 */
export async function serverIdForCommand(
  node?: { meta?: { serverId?: unknown } },
  opts: { alwaysAsk?: boolean; placeHolder?: string } = {},
): Promise<string | undefined> {
  const fromNode = node?.meta?.serverId;
  if (typeof fromNode === 'string') { return fromNode; }
  const ids = await getConnectedIdsRestored();
  if (ids.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.'));
    return undefined;
  }
  if (ids.length === 1 && !opts.alwaysAsk) { return ids[0]; }
  const picked = await vscode.window.showQuickPick(
    ids.map(id => {
      const url = getServerConfig(id)?.serverUrl;
      // By id first: two profiles on the same URL would both show the first one's name.
      const name = (_ctx && getServer(_ctx, id)?.name) || (url && getServerNameByUrl(url)) || id;
      return { label: name, description: url, id };
    }),
    { placeHolder: opts.placeHolder ?? vscode.l10n.t('Select a connected server.') },
  );
  return picked?.id;
}
