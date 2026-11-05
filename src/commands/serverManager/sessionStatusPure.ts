/**
 * State of connected servers' sessions, for the dot in the tree.
 *
 * Pure, without `vscode`: `sessionStatus.ts` feeds in expiry times.
 */
export interface SessionProbe {
  serverId: string;
  name: string;
  /** From `transport/session.ts#sessionExpiresAt`; `undefined` = no session. */
  expiresAt: number | undefined;
}

/**
 * When the display needs to check again next: at the earliest expiry of a
 * still-live session. `undefined` = none is live, nothing to schedule.
 */
export function nextExpiry(probes: SessionProbe[], now: number): number | undefined {
  const live = probes.map(p => p.expiresAt).filter((t): t is number => t !== undefined && t > now);
  return live.length > 0 ? Math.min(...live) : undefined;
}

/** State of a server node for the colored dot in the tree. */
export type ServerState = 'live' | 'expired' | 'disconnected';

export function serverState(connected: boolean, expiresAt: number | undefined, now: number): ServerState {
  if (!connected) { return 'disconnected'; }
  return expiresAt === undefined || expiresAt <= now ? 'expired' : 'live';
}
