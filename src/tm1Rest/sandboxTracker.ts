import type { Tm1Config } from './transport/types';

/**
 * Per-server "active sandbox" state, persisted in workspaceState.
 *
 * Memento key pattern: `tm1.sandbox.active.<serverId>` → string | undefined.
 * Undefined / missing = "Base" (no sandbox header sent).
 *
 * Hot-path helper `getSandboxHeaders(serverId)` returns the
 * `{ 'TM1-Sandbox': <name> }` header dict ready to pass as `extraHeaders` to
 * `apiRequest`/`apiRequestBinary`. Returns undefined when no sandbox is active
 * for that server.
 *
 * Phase B of the Sandbox-Awareness MVP — UI commands wire setActive/clear,
 * Phase C threads getSandboxHeaders into CubeViewer + MDX-Runner.
 */

const KEY_PREFIX = 'tm1.sandbox.active.';
const SANDBOX_HEADER = 'TM1-Sandbox';

/** Minimal Memento subset (also used by TreeExpansionStore — keeps tests lean). */
export interface Memento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

function key(serverId: string): string {
  return `${KEY_PREFIX}${serverId}`;
}

export class SandboxTracker {
  private readonly _emitters = new Set<(serverId: string) => void>();

  constructor(private readonly _memento: Memento) {}

  /** Returns the active sandbox name for the server, or undefined for base. */
  getActive(serverId: string): string | undefined {
    const v = this._memento.get<string>(key(serverId));
    return v && v.length > 0 ? v : undefined;
  }

  /** Sets the active sandbox name for the server. Pass undefined/empty to clear (= back to base). */
  async setActive(serverId: string, sandboxName: string | undefined): Promise<void> {
    const normalized = sandboxName && sandboxName.length > 0 ? sandboxName : undefined;
    await this._memento.update(key(serverId), normalized);
    for (const fn of this._emitters) { fn(serverId); }
  }

  /** Subscribe to active-sandbox changes for any server. Returns unsubscribe fn. */
  onDidChange(listener: (serverId: string) => void): () => void {
    this._emitters.add(listener);
    return () => this._emitters.delete(listener);
  }

  /**
   * Hot path — call this from any request site that should be sandbox-aware
   * (CubeViewer cell reads, MDX runs, view executions).
   * Returns undefined when no sandbox is active (caller passes no extraHeaders).
   */
  getSandboxHeaders(serverId: string): Record<string, string> | undefined {
    const name = this.getActive(serverId);
    if (!name) { return undefined; }
    return { [SANDBOX_HEADER]: name };
  }
}

// ─── Singleton + config-keyed helpers ────────────────────────────────────────
//
// The tree-level API takes serverId, but most REST call-sites (CubeViewer,
// MDX-Runner) only have a Tm1Config. The injected resolver maps it back to the
// profile id. It takes the whole config, not the URL: two profiles may share a
// serverUrl (another user, another v12 database), and the first one with that
// URL is not necessarily the one making the request.

let _singleton: SandboxTracker | null = null;
let _serverIdResolver: ((cfg: Tm1Config) => string | undefined) | null = null;

export function setSandboxTrackerSingleton(t: SandboxTracker | null): void {
  _singleton = t;
}

export function setServerIdResolver(fn: ((cfg: Tm1Config) => string | undefined) | null): void {
  _serverIdResolver = fn;
}

/**
 * Look up the active sandbox header dict for a server config.
 * Returns undefined when no tracker is wired, no resolver is wired, the config
 * is not a known profile, or no sandbox is active for that profile.
 */
export function getActiveSandboxHeaders(cfg: Tm1Config | undefined): Record<string, string> | undefined {
  if (!cfg || !_singleton || !_serverIdResolver) { return undefined; }
  const id = _serverIdResolver(cfg);
  if (!id) { return undefined; }
  return _singleton.getSandboxHeaders(id);
}

/** Look up the active sandbox NAME for a server config (for URL-param threading). */
export function getActiveSandboxName(cfg: Tm1Config | undefined): string | undefined {
  if (!cfg || !_singleton || !_serverIdResolver) { return undefined; }
  const id = _serverIdResolver(cfg);
  if (!id) { return undefined; }
  return _singleton.getActive(id);
}

/**
 * Merge active sandbox header (if any) into an existing extraHeaders dict.
 * Use at REST call-sites that should be sandbox-aware:
 *   apiRequest('POST', path, body, t, cfg, withSandbox(cfg, extra))
 */
export function withSandbox(
  cfg: Tm1Config | undefined,
  extra?: Record<string, string>,
): Record<string, string> | undefined {
  const sb = getActiveSandboxHeaders(cfg);
  if (!sb) { return extra; }
  return { ...sb, ...(extra ?? {}) };
}
