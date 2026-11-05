/**
 * HTML escape for values that come from the server (object names) and are written
 * into a webview. Leaf without imports.
 *
 * Host-side HTML builders use this one; webview bundles use the twin in
 * webviewClient/htmlUtils.ts. Both escape `'` as well, so a value stays safe in a
 * single-quoted attribute. Inline scripts inside template literals still carry
 * their own copy — they cannot import.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
