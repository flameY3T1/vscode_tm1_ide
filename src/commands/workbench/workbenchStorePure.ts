import type { SavedWindow } from './windowKinds';

/** Maximum number of windows per workbench. Visible in the selection window, not silent. */
export const MAX_WINDOWS = 20;

/**
 * Maximum number of workbenches PER SERVER.
 *
 * The window cap only limits a single workbench; the number of
 * workbenches was unbounded. But every `save`/`remove` rewrites the
 * COMPLETE `globalState` key — so the write cost grows with the total
 * stock, not with the change. Hence a cap per server.
 */
export const MAX_WORKBENCHES = 15;

/**
 * Discards the oldest workbenches of THE SAME server until the cap holds.
 *
 * LRU via `savedAt`. Other servers stay untouched — they do share the
 * storage key, but not the quota. The workbench currently being written
 * (`keepId`) never gets dropped, even if its `savedAt` is old (renaming
 * keeps the old timestamp).
 */
function _capPerServer(all: Workbench[], keepId: string, serverId: string): Workbench[] {
  const sameServer = all.filter(w => w.serverId === serverId);
  const excess = sameServer.length - MAX_WORKBENCHES;
  if (excess <= 0) {
    return all;
  }
  const droppable = sameServer
    .filter(w => w.id !== keepId)
    .sort((a, b) => a.savedAt - b.savedAt);
  const dropped = new Set(droppable.slice(0, excess).map(w => w.id));
  return all.filter(w => !dropped.has(w.id));
}

export interface Workbench {
  id: string;
  serverId: string;
  name: string;
  savedAt: number;
  windows: SavedWindow[];
}

/**
 * Stores a workbench, or replaces the one with the same `id`.
 *
 * Name equality is NOT checked here — that is the caller's business
 * (`saveFlow.ts` asks for "overwrite" on a name conflict and then passes
 * the `id` of the existing workbench).
 *
 * The cap kicks in here as a last safeguard; the actual information is
 * given by the selection window, which shows "20 possible" instead of
 * silently truncating.
 */
export function upsertWorkbench(all: Workbench[], next: Workbench): Workbench[] {
  const capped: Workbench = { ...next, windows: next.windows.slice(0, MAX_WINDOWS) };
  const at = all.findIndex(w => w.id === capped.id);
  const out = [...all];
  if (at < 0) {
    out.push(capped);
  } else {
    out[at] = capped;
  }
  return _capPerServer(out, capped.id, capped.serverId);
}
