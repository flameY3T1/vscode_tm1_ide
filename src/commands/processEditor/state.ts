import * as vscode from 'vscode';
import type { ProcessParameter, ProcessVariable, Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import { setExtensionContext } from '../../utils/extensionContext';
import { Tm1DebugClient } from '../../debug/tm1DebugClient';
import type { ProcessDraft } from './draftStore';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

export interface ProcessSnippet {
  id: string; trigger: string; name: string; description: string; body: string;
}

export interface ProcessCodeData {
  prolog: string; metadata: string; data: string; epilog: string;
  parameters: ProcessParameter[]; variables: ProcessVariable[];
  /** Process "Security access" flag — runs with full access regardless of user. */
  hasSecurity: boolean;
}

export interface BpRuntime {
  condition?: string;
  hitCondition?: string;
  hits: number;
}

export interface DebugSession {
  client: Tm1DebugClient;
  debugId: string;
  bpIds: Map<string, number>;
  nextBpId: number;
  /** Per-breakpoint runtime rule state, keyed by `bpKey`. Single source of
   *  truth (was three parallel Maps). `hits` = qualifying (expression-true)
   *  stop count; condition/hitCondition absent = that filter is off. */
  breakpoints: Map<string, BpRuntime>;
  /** Every panelKey this session's highlight has been routed to (StepIn into
   *  sub-processes). Used to broadcast `debugSessionEnded` to all of them, so a
   *  handed-off main editor doesn't stay stuck in debug mode when the run ends. */
  touchedKeys?: Set<string>;
  /** The panel where debug was started (the main process). Re-focused when the
   *  run ends, so the user lands back in the main editor instead of being
   *  stranded in a sub-process editor that ran to completion. */
  homeKey?: string;
  /** Set once the session is torn down (stop / panel dispose / cleanup). The
   *  long-poll loop and the re-sync timer check it between rounds, so neither
   *  can outlive the session (no orphaned timer after dispose). */
  cancelled?: boolean;
  /** Handle of the periodic status re-sync (see `startSessionSync`). Always
   *  cleared through `stopSessionSync` on every teardown path. */
  syncTimer?: ReturnType<typeof setInterval>;
  /** True while a user-driven step/continue round-trip is in flight. The
   *  re-sync tick skips those windows, so it can neither race the auto-continue
   *  loop nor issue overlapping requests. */
  busy?: boolean;
}

// ─── DI (set by configureProcessEditor on first ProcessEditorManager construction) ──────────

let _extensionUri: vscode.Uri | undefined;
let _getSnippets: (server?: string) => ProcessSnippet[] = () => [];
let _getActiveServer: () => string | undefined = () => undefined;
let _getServerName: (url: string) => string | undefined = () => undefined;

export function configureProcessEditor(opts: {
  getSnippets?: (server?: string) => ProcessSnippet[];
  getActiveServer?: () => string | undefined;
  extensionUri?: vscode.Uri;
  getServerName?: (url: string) => string | undefined;
  context?: vscode.ExtensionContext;
}): void {
  if (opts.getSnippets)     { _getSnippets = opts.getSnippets; }
  if (opts.getActiveServer) { _getActiveServer = opts.getActiveServer; }
  if (opts.extensionUri)    { _extensionUri = opts.extensionUri; }
  if (opts.getServerName)   { _getServerName = opts.getServerName; }
  if (opts.context)         { setExtensionContext(opts.context); }
}

/**
 * The snippets for the currently active server.
 *
 * Until 2026-08-29, `_getSnippets` was WRITTEN and never read: the wire from
 * `extension.ts` via `ProcessEditorManager` all the way here was fully laid,
 * it just ended here. That is why the native editor knew its own snippets
 * and the process editor did not — which looked from the outside like a
 * memory bug and was not one.
 */
export function getSnippets(): ProcessSnippet[] {
  return _getSnippets(_getActiveServer());
}

export function getExtensionUri(): vscode.Uri | undefined { return _extensionUri; }

// ─── Per-singleton state (the ProcessEditorManager is a true singleton, instantiated once in extension.ts) ──────────

/**
 * Everything the host keeps for one open process-editor panel.
 *
 * One object per panel INSTANCE, not one map per field keyed by
 * `serverKey|processName`: a process that is closed and reopened gets the same
 * key. With per-field maps, the old panel's late cleanup (behind
 * `await saveDraft(…)`) deleted the successor's entries — the intermittently
 * empty process editor. A cleanup now holds the old object and cannot reach
 * the new one, and closing a panel drops all of its state in one `delete`.
 */
export interface PanelSession {
  readonly panel: vscode.WebviewPanel;
  readonly key: string;
  readonly processName: string;
  readonly serverKey: string;
  readonly config: Tm1Config;
  /** Datasource attached on first hydrate. */
  dataSource?: any;
  dirty: boolean;
  /** What was LOADED or last SAVED; undefined until the load finished. */
  code?: ProcessCodeData;
  /**
   * Last content the webview mirrored to the host while typing.
   *
   * `code` holds what was LOADED or last SAVED; this holds what the user has
   * actually typed since. A webview panel close cannot be intercepted, so
   * without this mirror the host has nothing to park when a dirty panel vanishes.
   */
  draft?: ProcessDraft;
  readonly lintVersion: { value: number };
  /** Monaco is built and hydrated (after `monacoReady`). */
  hydrated: boolean;
  /** The webview has signalled `monacoReady`, but the process data may not have
   *  finished loading yet. Lets the load hydrate once data lands even if
   *  `monacoReady` fired first (fixes the intermittent empty-editor race). */
  ready: boolean;
  /** Debug-highlight message queued while the panel is not yet hydrated —
   *  flushed on `monacoReady`. Used when StepIn routes the cursor into a
   *  freshly-opened sub-process editor. */
  pendingDebugState?: HostToWebview;
  /** Last debug state message posted to the panel. The webview is push-driven,
   *  so a reload (`monacoReady` without dispose) would otherwise drop the
   *  highlight for good — re-posted on hydrate while the session still lives. */
  lastDebugState?: HostToWebview;
  /** Reveal target queued by openProcess, flushed to the webview after hydration. */
  pendingReveal?: { section: string; line: number };
}

/** Open panels by `serverKey|processName`. */
export const _sessions = new Map<string, PanelSession>();
/** Debug sessions by the panelKey that currently owns them. Not part of
 *  `PanelSession`: StepIn re-homes a debug session to another panel. */
export const _debugSessions = new Map<string, DebugSession>();

export function newPanelSession(panel: vscode.WebviewPanel, processName: string, serverKey: string, config: Tm1Config): PanelSession {
  return {
    panel, key: panelKey(sessionScope(config), processName), processName, serverKey, config,
    dirty: false, lintVersion: { value: 0 }, hydrated: false, ready: false,
  };
}

/** The session of `panel`, or undefined once the panel is closed. */
export function sessionOfPanel(panel: vscode.WebviewPanel): PanelSession | undefined {
  for (const s of _sessions.values()) {
    if (s.panel === panel) { return s; }
  }
  return undefined;
}

/** True while `session` is still the registered one for its key (not closed, not replaced). */
export function isLive(session: PanelSession): boolean {
  return _sessions.get(session.key) === session;
}

let _lastActivePanel: vscode.WebviewPanel | null = null;
export function setLastActivePanel(p: vscode.WebviewPanel | null): void { _lastActivePanel = p; }

// ─── Pure helpers ──────────

export function panelKey(serverKey: string, processName: string): string {
  return `${serverKey}|${processName}`;
}

/**
 * First half of a session key: the URL plus the identity tag. Two profiles may
 * share a serverUrl (other user, other v12 database); a key on the URL alone
 * revealed A's panel for B, and saves, runs and debugging went out as A.
 * `serverKey` stays the bare URL — lint/format config and titles belong to
 * the instance, and disconnect matches on `${serverUrl}|`.
 */
export function sessionScope(config: Tm1Config | undefined): string {
  const url = config?.serverUrl ?? '__default__';
  return config ? `${url}|@${identityTag(config)}` : url;
}

/** Persisted draft key: URL + name, as before — a draft is not tied to the login. */
export function draftKeyOf(serverKey: string, processName: string): string {
  return panelKey(serverKey, processName);
}

/** Open sessions of one process on one server, whichever profile opened them. */
export function sessionsOfProcess(serverUrl: string, processName: string): PanelSession[] {
  return [..._sessions.values()].filter(s => s.serverKey === serverUrl && s.processName === processName);
}

// TM1 object names cannot contain `|`, so the name is everything after the last one.
export function processNameOf(key: string): string {
  const idx = key.lastIndexOf('|');
  return idx === -1 ? key : key.substring(idx + 1);
}

/** TM1 object names are case-insensitive: the server always answers with the
 *  canonical spelling while a panelKey carries whatever the opener typed. Every
 *  process-name comparison in the debug path must go through this — a raw `===`
 *  makes a process look like a foreign sub-process and triggers a bogus re-home. */
export function sameProcessName(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) { return false; }
  return a.toLowerCase() === b.toLowerCase();
}

/** panelKey for (serverKey, processName), matching an already-open panel's
 *  process name case-insensitively. Falls back to the exact composite key when
 *  no panel is open. */
export function findPanelKey(serverKey: string, processName: string): string {
  const exact = panelKey(serverKey, processName);
  if (_sessions.has(exact)) { return exact; }
  for (const k of _sessions.keys()) {
    const idx = k.lastIndexOf('|');
    if (idx === -1) { continue; }
    if (k.substring(0, idx) === serverKey && sameProcessName(k.substring(idx + 1), processName)) { return k; }
  }
  return exact;
}

/** Stops a session's periodic re-sync. Idempotent — safe on every teardown path. */
export function stopSessionSync(session: DebugSession): void {
  if (session.syncTimer !== undefined) {
    clearInterval(session.syncTimer);
    session.syncTimer = undefined;
  }
}

/** Canonical key for a breakpoint: `${section}:${line}`. The section is the
 *  capitalized form (`capitalizeSection` output), so `bpIds` and `breakpoints`
 *  stay in lockstep. */
export function bpKey(section: string, line: number): string {
  return `${section}:${line}`;
}

/** Get-or-create the runtime record for a breakpoint key (hits start at 0). */
export function getBpRuntime(session: DebugSession, key: string): BpRuntime {
  let r = session.breakpoints.get(key);
  if (!r) { r = { hits: 0 }; session.breakpoints.set(key, r); }
  return r;
}

/** Set/clear condition and/or hit-count spec for a breakpoint (empty/whitespace
 *  ⇒ that filter off). Single source of the "empty means off" invariant. When
 *  the rule ends up fully empty the record is dropped. */
export function setSessionBpRule(
  session: DebugSession, key: string,
  patch: { condition?: string; hitCondition?: string },
): void {
  const r = getBpRuntime(session, key);
  if ('condition' in patch) {
    const c = (patch.condition ?? '').trim();
    r.condition = c === '' ? undefined : c;
  }
  if ('hitCondition' in patch) {
    const h = (patch.hitCondition ?? '').trim();
    r.hitCondition = h === '' ? undefined : h;
  }
  if (r.condition === undefined && r.hitCondition === undefined && r.hits === 0) {
    session.breakpoints.delete(key);
  }
}

/** Short display label for a server (profile name; hostname:port fallback), or undefined for the default server. */
export function serverLabel(serverKey: string): string | undefined {
  if (serverKey === '__default__') { return undefined; }
  const name = _getServerName(serverKey);
  if (name) { return name; }
  try {
    const u = new URL(serverKey);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return serverKey;
  }
}

export function getActivePanel(): vscode.WebviewPanel | null {
  if (_lastActivePanel && sessionOfPanel(_lastActivePanel)) {
    return _lastActivePanel;
  }
  for (const s of _sessions.values()) {
    if (s.panel.active) { return s.panel; }
  }
  return null;
}

/** Maps Monaco's lowercase section keys to the capitalized form the TM1 debug
 *  server expects. Returns '' for unknown input. */
export function capitalizeSection(raw: string): 'Prolog' | 'Metadata' | 'Data' | 'Epilog' | '' {
  const lc = raw.toLowerCase();
  if (lc === 'prolog')   { return 'Prolog'; }
  if (lc === 'metadata') { return 'Metadata'; }
  if (lc === 'data')     { return 'Data'; }
  if (lc === 'epilog')   { return 'Epilog'; }
  return '';
}
