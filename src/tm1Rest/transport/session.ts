// src/tm1Rest/transport/session.ts
// TM1 session-cookie cache + keep-alive agent management.
// One cookie + one agent per (serverUrl, user, authType, camNamespace) tuple.

import * as http from 'http';
import * as https from 'https';
import { createHash } from 'crypto';
import type { Tm1Config } from './types';
import { resolveAgent } from './agent';

/**
 * Session-cache-internal carrier: a stored (password-stripped) cfg keeps a
 * NON-reversible fingerprint of its auth secret under `_secretFp` so the cache
 * key stays stable after `_setSession` blanks the plaintext password. Kept as a
 * local cast type — the fingerprint is a transport-internal detail and does not
 * belong on the widely-imported public `Tm1Config`.
 */
type FingerprintedCfg = Tm1Config & { _secretFp?: string };

/**
 * Non-reversible fingerprint of the per-profile auth secret (the password),
 * folded into the session-cache key. Without it, two profiles with an identical
 * identity tuple (serverUrl|user|authType|namespace[|instance|db]) but DIFFERENT
 * passwords collide on one cache entry → a wrong password "works" off the cached
 * cookie and closeSession on one kills the other (cross-profile cookie bleed).
 *
 * A live cfg from a caller has no `_secretFp`, so the fingerprint is computed
 * from `password`. A stored/stripped cfg carries the precomputed `_secretFp`
 * (password blanked) so re-deriving the key later — e.g. closeAllSessions
 * iterating `_allSessions()` — yields the same key. NEVER the plaintext.
 * Configs without a password fingerprint '' → behaviour unchanged for them.
 */
function _secretFingerprint(cfg: Tm1Config): string {
  const stored = (cfg as FingerprintedCfg)._secretFp;
  if (stored !== undefined) { return stored; }
  const secret = cfg.password ?? '';
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export interface SessionEntry {
  /** Full "TM1SessionId=abc123" pair, ready for the Cookie request header. */
  cookie: string;
  /** Keep-alive agent reused for all requests against this server. */
  agent:  http.Agent | https.Agent;
  /**
   * Snapshot of the Tm1Config that opened this session — password stripped.
   * closeAllSessions hands this directly to closeSession during deactivate
   * so we don't have to reconstruct it from the cache key (which loses
   * rejectUnauthorized and cannot disambiguate `|` in URLs).
   */
  cfg: Tm1Config;
  /** Epoch ms of last successful use — for idle-timeout invalidation. */
  lastUsed: number;
}

/**
 * Idle timeout for cached TM1 sessions WHEN THE SERVER'S OWN VALUE IS UNKNOWN.
 * TM1's default (HTTPSessionTimeoutMinutes) is 20 min — we invalidate 5 min
 * earlier so we never reuse a cookie the server has already dropped.
 * Test-overridable via _setSessionIdleTimeoutForTest.
 *
 * Once the server has stated its timeout (`setServerSessionTimeout`, read at
 * connect time), THAT value applies. With the fixed quarter hour, the
 * extension used to log back in even on servers that hold sessions for two
 * hours (test server: `P0DT02H00M00S`, measured 2026-09-23) — with CAM,
 * every such login costs up to 20 s.
 */
let _sessionIdleTimeoutMs = 15 * 60 * 1000;

/** Margin against the server timeout: better to log in too early than reuse a dead cookie. */
const SERVER_TIMEOUT_MARGIN_MS = 60 * 1000;

/** Session key → effective idle limit derived from the server value. */
const _serverIdleTimeoutMs = new Map<string, number>();

/** Remembers the timeout the server states for this session. */
export function setServerSessionTimeout(cfg: Tm1Config, serverMs: number): void {
  if (!Number.isFinite(serverMs) || serverMs <= 0) { return; }
  _serverIdleTimeoutMs.set(_sessionCacheKey(cfg), Math.max(serverMs - SERVER_TIMEOUT_MARGIN_MS, 60 * 1000));
}

function _idleTimeoutFor(key: string): number {
  return _serverIdleTimeoutMs.get(key) ?? _sessionIdleTimeoutMs;
}

/**
 * When the session for `cfg` counts as expired (epoch ms), or `undefined` if
 * none exists at all — in that case the next request logs in again anyway.
 * Reads only the cache, no network.
 */
export function sessionExpiresAt(cfg: Tm1Config): number | undefined {
  const key = _sessionCacheKey(cfg);
  const entry = _sessionCache.get(key);
  return entry ? entry.lastUsed + _idleTimeoutFor(key) : undefined;
}

export function _setSessionIdleTimeoutForTest(ms: number): void {
  _sessionIdleTimeoutMs = ms;
}

export function _getSessionIdleTimeout(): number {
  return _sessionIdleTimeoutMs;
}

// One cookie + agent per tuple. Trailing-slash in serverUrl is normalized
// in _sessionCacheKey so callers cannot accidentally miss the cache.
const _sessionCache = new Map<string, SessionEntry>();

/**
 * Outcome of an init-Basic-Auth attempt, propagated from the lock-holder to
 * waiters via the `_initInflight` promise. Waiters use `status` to decide
 * whether to re-attempt Basic (lock-holder hit 2xx/5xx/network → retry init)
 * or short-circuit with 401 (bad creds → re-attempts would only multiply
 * authentication failures across the N concurrent callers, triggering
 * account-lockout on the TM1 server).
 */
export interface InitOutcome {
  /** HTTP status from the lock-holder's init request. 0 = exception/network error. */
  status: number;
}

/**
 * Tracks in-flight initial-session-open calls per cfg key. Without this,
 * a burst of N parallel first-calls (e.g. tree refresh on connect) each
 * observes an empty cache, sends Basic auth, and TM1 opens N sessions —
 * all but one orphan immediately. With the lock, the leader's real request
 * opens the session, followers await, then everyone reuses the same cookie.
 *
 * The promise resolves with `InitOutcome` so waiters know whether the
 * lock-holder succeeded (proceed with cached cookie) or failed with 401
 * (return synthetic 401 without their own Basic-Auth attempt).
 */
export const _initInflight = new Map<string, Promise<InitOutcome>>();

/**
 * Key prefix for caches whose content depends on who asks: element security,
 * private views, impersonation and the v12 database all change what a server
 * returns. The bare URL comes first, so clearing one server still matches by
 * the prefix `${serverUrl}|`.
 */
export function cacheScope(cfg: Tm1Config): string {
  return `${cfg.serverUrl}|${_sessionCacheKey(cfg)}`;
}

/**
 * Short tag of the session identity for in-memory panel keys. Two profiles may
 * share a serverUrl (other user, other v12 database); a panel keyed by the URL
 * alone would be revealed for the second one while still sending as the first.
 * Panel keys put it right behind the URL and the manager's own separator, so
 * prefix matches on `${serverUrl}<sep>` (disconnect, broadcasts) keep working.
 */
export function identityTag(cfg: Tm1Config): string {
  return createHash('sha256').update(_sessionCacheKey(cfg)).digest('hex').slice(0, 12);
}

export function _sessionCacheKey(cfg: Tm1Config): string {
  const url = cfg.serverUrl.replace(/\/$/, '');
  let key = `${url}|${cfg.username}|${cfg.authType ?? 'Basic'}|${cfg.camNamespace ?? ''}`;
  // v12: append instance and database to distinguish same gateway+user with different databases
  if (cfg.version === 'v12' && cfg.v12) {
    key += `|${cfg.v12.instance}|${cfg.v12.database}`;
    // The minted identity is the {User} body (tm1User), not the App-Client ID in
    // `username`: two profiles on one App-Client must not share a session.
    key += `|${cfg.v12.authMode}|${cfg.v12.tm1User}`;
  }
  // An impersonated view is its own session — otherwise the entry for the
  // user's own account would be reused and the impersonation would go
  // nowhere.
  if (cfg.impersonate) { key += `|imp:${cfg.impersonate}`; }
  // Fold a non-reversible fingerprint of the auth secret in last so profiles
  // that share an identity tuple but differ only by password never collide.
  key += `|${_secretFingerprint(cfg)}`;
  return key;
}

export function _getSession(cfg: Tm1Config): SessionEntry | undefined {
  const key = _sessionCacheKey(cfg);
  const entry = _sessionCache.get(key);
  if (!entry) { return undefined; }
  if (Date.now() - entry.lastUsed > _idleTimeoutFor(key)) {
    // Discard only the cache entry — do NOT destroy the agent. Another
    // request may currently be running on this keep-alive agent (e.g. a long
    // TI execute whose lastUsed is only set after the response); destroy()
    // would kill its socket with ECONNRESET. The orphaned agent gets no more
    // new requests; its sockets are reaped by the server-side keep-alive
    // timeout. Explicit destroy only in closeSession.
    _sessionCache.delete(key);
    return undefined;
  }
  return entry;
}

/** Listeners for newly created sessions — this turns the status indicator green again. */
const _sessionListeners = new Set<() => void>();
export function onSessionOpened(fn: () => void): { dispose(): void } {
  _sessionListeners.add(fn);
  return { dispose: () => { _sessionListeners.delete(fn); } };
}

export function _setSession(cfg: Tm1Config, entry: SessionEntry): void {
  // Strip the password before storing — the entry is iterated by
  // closeAllSessions and the cached cfg should not retain credentials. Carry a
  // non-reversible fingerprint of the (pre-strip) secret so the cache key stays
  // stable when it is later re-derived from this stored, password-blanked cfg.
  const stripped: Tm1Config = { ...entry.cfg, password: '', _secretFp: _secretFingerprint(entry.cfg) } as FingerprintedCfg;
  _sessionCache.set(_sessionCacheKey(cfg), { ...entry, cfg: stripped, lastUsed: Date.now() });
  for (const fn of _sessionListeners) { try { fn(); } catch { /* the indicator must not break a request */ } }
}

/** Refresh lastUsed timestamp on a successful request — extends idle TTL. */
export function _touchSession(cfg: Tm1Config): void {
  const entry = _sessionCache.get(_sessionCacheKey(cfg));
  if (entry) { entry.lastUsed = Date.now(); }
}

/**
 * Discards the cached session entry (cookie).
 *
 * Set `destroyAgent` to true ONLY on explicit teardown (closeSession). On
 * the 401/re-mint path (default false) the keep-alive agent must NOT be
 * destroyed: a 401 burst (tree refresh with a stale cookie) invalidates on
 * the first 401 — the N-1 parallel sibling requests share the same agent
 * and would otherwise die with ECONNRESET instead of a clean 401 (no
 * re-auth retry). The orphaned agent gets no new requests; its sockets are
 * reaped by the server-side keep-alive timeout.
 */
export function _invalidateSession(cfg: Tm1Config, destroyAgent = false): void {
  const key = _sessionCacheKey(cfg);
  const existing = _sessionCache.get(key);
  if (existing) {
    if (destroyAgent) { existing.agent.destroy(); }
    _sessionCache.delete(key);
  }
}

/**
 * Negative-auth cache: keys whose last Basic-Auth attempt returned 401 (bad
 * username/password). Once a key is armed, `requestWithSession` short-circuits
 * with a synthetic 401 WITHOUT touching the network.
 *
 * Why: a single bad-credential config is hit by many independent features
 * (tree refresh, completion, health poll, diagnostics) spaced out over time.
 * Each call observing an empty session cache would re-send the same wrong
 * Basic-Auth → the TM1 server counts N failed logins → account lockout. The
 * init-lock only dedups *concurrent* bursts; this cache stops the slow drip.
 *
 * Cleared on explicit (re)connect (`serverManager.connect`) and on session
 * close (`closeSession`), so the user can retry after fixing the password.
 */
/**
 * Why the last sign-in failed. Without it the fast-fail path can only answer
 * `401` — which reads as "wrong password" even when the credentials were never
 * sent, because Windows single sign-on could not start its helper process at
 * all. That case reports status 0 and carries the real reason in `message`.
 */
export interface AuthFailure { status: number; message: string }

const _authFailed = new Map<string, AuthFailure | undefined>();

/**
 * Arm the negative-auth cache. Without `failure` the caller means the classic
 * case — a 401 on Basic auth — and the fast-fail answers `401` as before.
 */
const _browserExpiredListeners = new Set<(cfg: Tm1Config) => void>();

/** Fires when a browser-login session is rejected (http.ts); the UI offers a new login. */
export function onBrowserSessionExpired(fn: (cfg: Tm1Config) => void): { dispose(): void } {
  _browserExpiredListeners.add(fn);
  return { dispose: () => { _browserExpiredListeners.delete(fn); } };
}

export function _fireBrowserSessionExpired(cfg: Tm1Config): void {
  for (const fn of _browserExpiredListeners) { fn(cfg); }
}

export function _markAuthFailed(cfg: Tm1Config, failure?: AuthFailure): void {
  _authFailed.set(_sessionCacheKey(cfg), failure);
}

/** True if cfg's last sign-in attempt was rejected and not yet reset. */
export function _isAuthFailed(cfg: Tm1Config): boolean {
  return _authFailed.has(_sessionCacheKey(cfg));
}

/** The reason recorded with `_markAuthFailed`, if the caller gave one. */
export function _authFailure(cfg: Tm1Config): AuthFailure | undefined {
  return _authFailed.get(_sessionCacheKey(cfg));
}

/** Reset the negative-auth cache so the next call retries Basic auth. */
export function _clearAuthFailed(cfg: Tm1Config): void {
  _authFailed.delete(_sessionCacheKey(cfg));
}

/**
 * Returns the agent for cfg's cached session, or a fresh keep-alive agent
 * if none is cached. Ownership: a freshly-created agent is NOT stored — the
 * caller must call `_setSession` after a successful response, otherwise the
 * agent is abandoned. Accepted in concurrent first-call bursts: at most one
 * agent per tuple becomes the cached one; others are orphaned and GC'd when
 * their sockets time out.
 */
export function _getOrCreateAgent(cfg: Tm1Config, isHttps: boolean): http.Agent | https.Agent {
  const existing = _getSession(cfg);
  if (existing) { return existing.agent; }
  return resolveAgent(cfg, isHttps);
}

/** Snapshot of cached session entries — used by closeAllSessions to iterate safely. */
export function _allSessions(): SessionEntry[] {
  return [..._sessionCache.values()];
}

/** Test-only accessors. Named with leading underscore to signal "internal". */
export function _setSessionForTest(cfg: Tm1Config, cookie: string): void {
  const isHttps = cfg.serverUrl.startsWith('https:');
  const agent = isHttps
    ? new https.Agent({ keepAlive: true, rejectUnauthorized: cfg.rejectUnauthorized })
    : new http.Agent({ keepAlive: true });
  _setSession(cfg, { cookie, agent, cfg, lastUsed: Date.now() });
}

export function _getSessionForTest(cfg: Tm1Config): SessionEntry | undefined {
  return _getSession(cfg);
}

export function _clearAllSessionsForTest(): void {
  for (const entry of _sessionCache.values()) { entry.agent.destroy(); }
  _sessionCache.clear();
  _authFailed.clear();
}
