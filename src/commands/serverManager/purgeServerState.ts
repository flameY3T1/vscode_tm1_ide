/**
 * Discards everything that was attached to a server profile when it is
 * deleted.
 *
 * Previously, `deleteServer` cleaned up two of nine stores — the workbenches
 * (review H4, 2026-08-24) and the attribute columns (task 8), both added one
 * at a time after being noticed individually. The remaining seven kept their
 * entries permanently and unreachably in `globalState`: nothing pointed to
 * them anymore, and no path ever touched them again.
 *
 * Generic over `SERVER_STATE_KEYS` instead of seven calls in a row, so the
 * eighth store isn't forgotten again — and a LEAF module (only `stateKeys`),
 * because importing the store modules would close a cycle back to
 * `serverManager`.
 */
import { purgeLastParamsForServer } from '../paramMemory';
import {
  SERVER_STATE_KEYS, prefixFor,
  type ServerStateKey,
} from '../../serverState/stateKeys';

export interface PurgeTarget {
  /** Profile id of the deleted server. */
  serverId: string;
  /** Its `serverUrl`. */
  serverUrl: string;
  /**
   * Whether, AFTER the deletion, a profile still points to the same
   * `serverUrl`.
   *
   * Two profiles are allowed to point to the same instance with different
   * users. If this weren't asked here, deleting one profile would rip away
   * the linter rules, formatting rules and MDX history from the other.
   */
  urlStillInUse: boolean;
}

/** Only the part of the `ExtensionContext` that the cleanup touches.
 *  `keys()` is needed only by `paramMemory`, whose server reference sits in
 *  the `globalState` key rather than in the value. */
export interface PurgeMemento {
  globalState: {
    get<T>(key: string): T | undefined;
    keys?(): readonly string[];
    update(key: string, value: unknown): Thenable<void>;
  };
}

async function purgeOne(
  ctx: PurgeMemento, entry: ServerStateKey, serverKey: string,
): Promise<number> {
  const raw = ctx.globalState.get<unknown>(entry.key);

  if (entry.shape.kind === 'list') {
    if (!Array.isArray(raw)) { return 0; }
    const field = entry.shape.field;
    const kept = raw.filter(
      e => (e as Record<string, unknown> | null)?.[field] !== serverKey,
    );
    const removed = raw.length - kept.length;
    if (removed === 0) { return 0; }
    await ctx.globalState.update(entry.key, kept);
    return removed;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return 0;
  }
  const map = raw as Record<string, unknown>;
  const matches = entry.shape.kind === 'prefixedRecord'
    ? (k: string) => k.startsWith(prefixFor(serverKey))
    : (k: string) => k === serverKey;

  const kept: Record<string, unknown> = {};
  let removed = 0;
  for (const [k, v] of Object.entries(map)) {
    if (matches(k)) { removed++; } else { kept[k] = v; }
  }
  if (removed === 0) { return 0; }
  await ctx.globalState.update(entry.key, kept);
  return removed;
}

/**
 * Cleans up all server-bound stores of the deleted profile.
 *
 * A failure at one store must not hold up the others, and must especially
 * not derail the deletion — the profile is already gone by this point, and
 * throwing here would leave the user with an error message about a
 * successfully deleted server.
 *
 * @returns Total number of removed entries (for tests and logging).
 */
export async function purgeServerState(
  ctx: PurgeMemento, target: PurgeTarget,
): Promise<number> {
  let removed = 0;
  for (const entry of SERVER_STATE_KEYS) {
    if (entry.space === 'url' && target.urlStillInUse) { continue; }
    const serverKey = entry.space === 'id' ? target.serverId : target.serverUrl;
    if (!serverKey) { continue; }
    try {
      removed += await purgeOne(ctx, entry, serverKey);
    } catch (e) {
      console.error(`[purgeServerState] ${entry.key} (${entry.what}) failed:`, e);
    }
  }
  // Outside the table because its server reference sits in the key rather
  // than in the value — reasoned out in `commands/paramMemory.ts`.
  if (!target.urlStillInUse) {
    try {
      removed += await purgeLastParamsForServer(ctx, target.serverUrl);
    } catch (e) {
      console.error('[purgeServerState] tm1.lastParams (remembered parameters) failed:', e);
    }
  }
  return removed;
}
