// src/webviewClient/_shared/l10n.ts
// Shared webview-client i18n helper. `vscode.l10n` does not work inside the
// webview sandbox, so the extension resolves all UI strings server-side (via
// `vscode.l10n.t`) and injects the resolved map as `window.__l10n` through the
// webview shell's `globals`. Clients read it here.
//
// Pattern (Phase 3): one `build<Bundle>L10n()` map per webview lives next to the
// shell caller; body markup is rendered server-side from the same map, so static
// text is already translated (no FOUC). Clients use `getL10n()` for runtime text.

/** Resolved UI strings injected by the extension as `window.__l10n`. */
export type L10nMap = Record<string, string>;

/** Returns the injected `window.__l10n` map (empty object if absent). */
export function getL10n(): L10nMap {
  return (globalThis as unknown as { __l10n?: L10nMap }).__l10n ?? {};
}

/**
 * Returns `map[key]` with `{0}`, `{1}`, … placeholders replaced positionally.
 * Falls back to the key itself if the string is missing (defensive — should not
 * happen once the map is complete).
 */
export function fmt(map: L10nMap, key: string, ...args: (string | number)[]): string {
  const s = map[key] ?? key;
  return s.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}
