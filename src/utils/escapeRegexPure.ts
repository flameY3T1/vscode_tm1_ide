/** Escape a literal string for use inside a RegExp. Pure — host and webview import it. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
