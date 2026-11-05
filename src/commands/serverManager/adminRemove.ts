/**
 * Removes an admin-server entry — including the question of what should
 * happen to the instances discovered through it.
 *
 * This lives here and not in the command because there are TWO paths to the
 * same action: the context-menu entry `tm1.adminServer.remove` on the tree
 * node, and the delete button in the edit view (`addServerPanel`). Both must
 * ask the same confirmation question and spare the same children; two
 * copies of the same rules would be exactly the spot where one of them goes
 * stale.
 */
import * as vscode from 'vscode';
import { getAllServers, saveServers, type ServerProfile } from '../../serverState/state';
import { getAdminServer, removeAdminServer } from '../../serverState/adminServers';
import { deleteServer } from './form';

/**
 * Asks for confirmation and removes the admin server.
 *
 * @returns `true` if the entry was removed; `false` on cancellation or an
 *          unknown id — the caller uses this to decide whether it may close
 *          its window.
 */
export async function removeAdminServerWithChildren(
  context: vscode.ExtensionContext,
  adminId: string,
): Promise<boolean> {
  const admin = getAdminServer(adminId);
  if (!admin) { return false; }

  const servers = getAllServers(context);
  const children = servers.filter(s => s.parentAdminId === adminId);
  // A child that already sits in a folder was put there on purpose —
  // "delete servers too" must spare it and only cut the admin-server link,
  // same as "keep servers" would.
  // This state can no longer be produced through the UI as of 2026-08-27:
  // `tm1.server.moveToFolder` no longer appears on discovered nodes, because
  // `detach` now brings its own folder choice along. The branch stays
  // anyway, because profiles with both `parentAdminId` AND `folder` can
  // exist in the wild — the intermediate build that was click-tested could
  // create them.
  const inFolder = children.filter(s => s.folder);
  const deletable = children.filter(s => !s.folder);

  const KEEP = vscode.l10n.t('Keep servers');

  let answer: string | undefined;
  if (deletable.length === 0) {
    // Nothing would be deleted at all — offering "delete servers too"
    // would be a lie, whether that's because there are no children (yet)
    // or because every one of them already sits in a folder. Say so
    // plainly and offer only the one action that actually does something
    // (identical to "keep servers").
    const detail = inFolder.length > 0
      ? vscode.l10n.t(
        'All {0} discovered instance(s) already sit in a folder and will stay there — nothing would be deleted.',
        inFolder.length,
      )
      : vscode.l10n.t('No discovered instances to delete — nothing would be deleted.');
    answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Remove admin server "{0}"?', admin.name),
      { modal: true, detail },
      KEEP,
    );
  } else {
    const DELETE = vscode.l10n.t('Delete servers too');
    const detail = inFolder.length > 0
      ? vscode.l10n.t(
        '{0} server(s) will be deleted, {1} server(s) already in a folder will stay there instead.',
        deletable.length, inFolder.length,
      )
      : vscode.l10n.t('The instances discovered through it can stay as standalone servers, or be deleted along with their stored credentials.');
    answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Remove admin server "{0}"?', admin.name),
      { modal: true, detail },
      KEEP, DELETE,
    );
  }

  if (answer === KEEP) {
    // Re-read instead of reusing the `servers` snapshot from above — the
    // modal await is a window in which a tree refresh could have
    // written a fresher list.
    await saveServers(context, _unlink(getAllServers(context), adminId));
  } else if (answer !== undefined) {
    // "Delete servers too": run the folderless children through the
    // existing deleteServer pipeline — only there is an open session
    // disconnected (otherwise it leaks along with its disposers and the tree
    // keeps showing "Connected"), and only there are workbenches, saved
    // attribute columns AND the password cleaned up as well
    // (Review 2026-08-27, finding 3/5). Children that sit in a folder only
    // lose parentAdminId, like "keep servers" would do for them.
    for (const d of deletable) { await deleteServer(context, d.id); }
    if (inFolder.length > 0) {
      await saveServers(context, _unlink(getAllServers(context), adminId));
    }
  } else {
    return false;
  }

  await removeAdminServer(adminId);
  return true;
}

function _unlink(servers: ServerProfile[], adminId: string): ServerProfile[] {
  return servers.map(s => (s.parentAdminId === adminId ? { ...s, parentAdminId: undefined } : s));
}
