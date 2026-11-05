/**
 * Pure helpers for the Tm1TreeDataProvider.
 *
 * Extracted from `tm1TreeDataProvider.ts` (Post-H17 backlog #10). No DOM,
 * no vscode, no module state — inputs are explicit.
 */

import { isProcessGroupingMode, type ProcessGroupingMode } from './processGroupingPure';

export {};

/**
 * Decide whether a TM1 object name passes the tree's visibility filter.
 *
 *  - System objects (names starting with `}`) are hidden when `hideSystem` is true.
 *  - Free-text filter performs case-insensitive substring match.
 *  - Empty filter passes all (subject to the system-hide check).
 */
export function filterByName(name: string, hideSystem: boolean, filterText: string): boolean {
  if (hideSystem && name.startsWith('}')) { return false; }
  if (filterText && !name.toLowerCase().includes(filterText.toLowerCase())) { return false; }
  return true;
}

export interface ProcessGroupConfigResolved {
  token: string;
  mode: ProcessGroupingMode;
}

/**
 * Resolve the active process-group token + mode for a server.
 *
 * The per-server override map is the only source — no global layer, and no
 * default token: a server without an override gets an empty token, i.e. no
 * grouping at all. That is also what Reset (= dropping the override) restores.
 * An override holding an explicit empty string means the same thing.
 *
 * `serverKey` is the caller's map key (the server id) — undefined skips the
 * per-server lookup.
 */
export function resolveProcessGroupConfig(
  serverKey: string | undefined,
  tokenOverrides: Record<string, string> | undefined,
  modeOverrides: Record<string, string> | undefined,
  defaultMode: ProcessGroupingMode,
): ProcessGroupConfigResolved {
  let token = '';
  if (serverKey && tokenOverrides && Object.prototype.hasOwnProperty.call(tokenOverrides, serverKey)) {
    token = String(tokenOverrides[serverKey] ?? '');
  }

  let mode: ProcessGroupingMode = defaultMode;
  if (serverKey && modeOverrides && Object.prototype.hasOwnProperty.call(modeOverrides, serverKey)) {
    const m = String(modeOverrides[serverKey] ?? '');
    if (isProcessGroupingMode(m)) { mode = m; }
  }

  return { token, mode };
}

/**
 * Format an error caught while loading TM1 data for display.
 * Timeout errors collapse to a short, TRANSLATABLE base string instead of the
 * raw transport text — callers must wrap the result in `vscode.l10n.t(...)`,
 * which is why this module (pure, vscode-free) returns English only.
 * Other errors fall back to `err.message` or a generic label.
 *
 * The match is case-insensitive on purpose: `tm1Rest/transport/http.ts` cannot
 * import `vscode` (depcruise `tm1rest-no-vscode`) and therefore throws a plain
 * English `TM1 request timeout: …`, while other layers may say `Timeout`.
 */
export function formatTreeError(err: unknown): string {
  const msg = (err as { message?: unknown } | null)?.message;
  if (typeof msg === 'string' && msg.toLowerCase().includes('timeout')) {
    return 'Timeout — is the server reachable?';
  }
  return typeof msg === 'string' ? msg : 'Unknown error';
}
