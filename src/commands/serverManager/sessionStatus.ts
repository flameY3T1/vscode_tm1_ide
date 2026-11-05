// src/commands/serverManager/sessionStatus.ts
// Session dot behind the server node in the TM1 Explorer.
//
// Motivation (2026-09-23): with CAM, a login takes up to 20 s. If the
// session had expired, you only noticed it from the wait after clicking. The
// dot only reads the session cache (`sessionExpiresAt`) — no request to the
// server, so also no covert keep-alive or reconnect. A status bar display
// existed briefly; it's gone again, the dot is enough (requested 2026-09-23).
import * as vscode from 'vscode';
import { sessionExpiresAt, onSessionOpened } from '../../tm1Rest/transport/session';
import { getConnectedIds, getServerConfig, onServerChanged } from '../../serverState/state';
import { nextExpiry, serverState } from './sessionStatusPure';
import { SERVER_STATE_SCHEME } from '../../providers/tm1TreeNodes';

/**
 * Session state of a connected server. The dot itself sits in the server icon
 * (green = alive, ochre = expired, next action logs in again; since 2026-09-26,
 * drawn SVGs instead of emoji) — the tree provider swaps it without a request,
 * see `Tm1TreeDataProvider.setSessionIdle`. The file decoration only carries
 * the hover text now: a decoration can show text, never an image.
 */
const _decoChanged = new vscode.EventEmitter<undefined>();
const decorations: vscode.FileDecorationProvider = {
  onDidChangeFileDecorations: _decoChanged.event,
  provideFileDecoration(uri) {
    if (uri.scheme !== SERVER_STATE_SCHEME) { return undefined; }
    const id = decodeURIComponent(uri.path.replace(/^\//, ''));
    const cfg = getServerConfig(id);
    const state = serverState(cfg !== undefined, cfg ? sessionExpiresAt(cfg) : undefined, Date.now());
    if (state === 'live') {
      return new vscode.FileDecoration(undefined, vscode.l10n.t('Session active'));
    }
    if (state === 'expired') {
      return new vscode.FileDecoration(undefined, vscode.l10n.t('Session expired — the next action logs in again first'));
    }
    return undefined;
  },
};

let _timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Re-queries the dots and sets the timer to the next expiry — a single
 * timer, not a tick. Every request extends the session; the next look
 * catches that, since it then simply schedules later. +1 s to guard against
 * rounding at the boundary.
 */
let _setIdle: ((serverId: string, idle: boolean) => void) | undefined;

function update(): void {
  if (_timer) { clearTimeout(_timer); _timer = undefined; }
  _decoChanged.fire(undefined);
  const now = Date.now();
  for (const id of getConnectedIds()) {
    const cfg = getServerConfig(id);
    if (cfg) { _setIdle?.(id, serverState(true, sessionExpiresAt(cfg), now) === 'expired'); }
  }
  const next = nextExpiry(getConnectedIds().flatMap(id => {
    const cfg = getServerConfig(id);
    return cfg ? [{ serverId: id, name: id, expiresAt: sessionExpiresAt(cfg) }] : [];
  }), now);
  if (next !== undefined) { _timer = setTimeout(update, Math.min(next - now + 1000, 2_147_000_000)); }
}

export function registerSessionStatus(
  context: vscode.ExtensionContext,
  /** The tree's icon switch (`Tm1TreeDataProvider.setSessionIdle`). */
  setIdle?: (serverId: string, idle: boolean) => void,
): void {
  _setIdle = setIdle;
  context.subscriptions.push(
    { dispose: () => { if (_timer) { clearTimeout(_timer); } } },
    onServerChanged.event(update),
    // A new session (including the re-login after expiry) turns the dot green again.
    onSessionOpened(update),
    vscode.window.registerFileDecorationProvider(decorations),
  );
  // Right away, once: the reconnect at startup can finish before registration does.
  update();
}
