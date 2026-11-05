/**
 * The storage key of the workbenches and the cleanup of a server.
 *
 * Its own module and a LEAF: only `serverState/stateKeys` (itself
 * without imports), no `vscode` types. The obvious place would have been
 * `workbenchStore.ts`, but that pulls a cycle back to `serverManager` via
 * `workbenchStorePure` → `windowKinds` → `cubeViewer/manager` as soon as
 * `deleteServer` imports it (measured: 43 `no-circular` violations from
 * this one line). Storage is a key and an array — it does not need the
 * window kinds for that.
 */

import { WORKBENCH_STATE_KEY } from '../../serverState/stateKeys';

/**
 * The key has lived in `serverState/stateKeys.ts` since 2026-08-29,
 * where `purgeServerState` reads it along with everything else. Here it
 * is just passed through, because `workbenchStore` knows it under this
 * name.
 */
export const STATE_KEY = WORKBENCH_STATE_KEY;

/** Only the part of the `ExtensionContext` that the cleanup touches. */
export interface WorkbenchState {
  globalState: {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

/**
 * Discards the workbenches of a deleted server profile.
 *
 * `Workbench.serverId` IS the profile id. Without this, the entries would
 * permanently survive deletion of the profile: no view points to them
 * anymore, and the cap `MAX_WORKBENCHES` counts per `serverId`, so it
 * never reaches the orphaned stock (review 2026-08-24, H4).
 *
 * A free function instead of a method, because `deleteServer` only gets
 * handed the `ExtensionContext`, not the `WorkbenchStore` instance from
 * `extension.ts`. No `onDidChange`: `deleteServer` fires `onServerChanged`
 * anyway, and its workbench children disappear along with the server
 * node.
 *
 * What gets written is the RAW list minus the matches — a structurally
 * foreign entry of ANOTHER server survives this way, as `workbenchStore.ts`
 * promises. Only for its own `serverId` does cleanup weigh more heavily:
 * a broken entry of this server is removed along with it, because
 * otherwise nothing would ever touch it again.
 *
 * @returns Number of removed entries; 0 does not write at all.
 */
export async function purgeWorkbenchesForServer(
  context: WorkbenchState,
  serverId: string,
): Promise<number> {
  const raw = context.globalState.get<unknown>(STATE_KEY);
  if (!Array.isArray(raw)) {
    return 0;
  }
  const keep = raw.filter(w => (w as { serverId?: unknown } | null)?.serverId !== serverId);
  const removed = raw.length - keep.length;
  if (removed === 0) {
    return 0;
  }
  await context.globalState.update(STATE_KEY, keep);
  return removed;
}
