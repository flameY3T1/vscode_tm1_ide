import { getNonce } from '../utils/nonce';
import { escapeHtml } from '../utils/escapeHtml';

/**
 * Language for `<html lang>`, set once on activation from `vscode.env.language`.
 * The default value was `de` — in an English UI every webview thereby got
 * German hyphenation and screen-reader language, and ten
 * callers carried the same case distinction by hand (Codex finding B17).
 * As a setter instead of an import, so that this module stays vscode-free and pure.
 */
let _uiLanguage = 'en';

/** Call once in `activate()` with `vscode.env.language`. */
export function setUiLanguage(lang: string | undefined): void {
  if (lang) { _uiLanguage = lang; }
}

/**
 * Central webview shell (A2, 2026-06-10): CSP/nonce scaffold for all
 * bundle-based webview panels. Replaces ~13 almost identical
 * `getHtml()` templates in `commands/**` and `processTemplates/`.
 *
 * Standard CSP: `default-src 'none'`, styles from `cspSource` + inline,
 * scripts only with a nonce, fonts/images from `cspSource` + `data:`.
 */
export interface WebviewShellOptions {
  /** `webview.cspSource` of the panel. */
  cspSource: string;
  /** `<html lang>`; the default is the UI language (see `setUiLanguage`). */
  lang?: string;
  /** Optional `<title>`. */
  title?: string;
  /** Insert `<meta name="viewport">`. */
  viewport?: boolean;
  /** `<link rel="stylesheet">` URIs (via `webview.asWebviewUri`, as string). */
  styleUris?: string[];
  /** Inline `<style>` content (CSS const). */
  css?: string;
  /** Static body markup. */
  body: string;
  /** `<script type="application/json" id=...>` blocks — `json` must be finished JSON. */
  jsonData?: { id: string; json: string }[];
  /** `window.<key> = <JSON value>` in a nonced inline script. */
  globals?: Record<string, unknown>;
  /** Additionally set `window.__tm1Nonce`. */
  exposeNonce?: boolean;
  /** Bundle `<script src>` URIs in load order (vendor first). */
  scriptUris?: string[];
  /**
   * Inline script body (real JS, no escaping by the helper) — emitted in a
   * nonced `<script>` AFTER `globals`/`jsonData`, so that `window.<key>` is
   * available. For self-contained webviews without a bundled script.
   */
  inlineScript?: string;
  /** Nonce injection for tests; default `getNonce()`. */
  nonce?: string;
}

/**
 * Escape an already-serialized string for safe embedding inside a `<script>`
 * element: `<` → `<` (no `</script>` breakout), U+2028/29 (which JS treats
 * as line terminators inside string literals) escaped. The result stays valid
 * JSON, so it is safe for `<script type="application/json">` blocks too.
 * Uses split/join with fromCharCode so the source carries no raw U+2028/29.
 */
function escapeScriptText(s: string): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return s.split('<').join('\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

/** JSON for inline `<script>`: `<` as < (no `</script>` breakout), U+2028/29 escaped. */
function jsonForInlineScript(value: unknown): string {
  return escapeScriptText(JSON.stringify(value));
}

export function renderWebviewShell(opts: WebviewShellOptions): string {
  const nonce = opts.nonce ?? getNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${opts.cspSource} data:`,
    `img-src ${opts.cspSource} data:`,
  ].join('; ');

  const head: string[] = ['<meta charset="UTF-8">'];
  if (opts.viewport) {
    head.push('<meta name="viewport" content="width=device-width,initial-scale=1.0">');
  }
  head.push(`<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  // Bind the color scheme to the VS Code theme, BEFORE the caller's sheet, so that
  // the caller can override it.
  //
  // The native dropdown windows (selection list of a `select`, suggestion list
  // of a `datalist`, date picker, scrollbars) are painted by the renderer according to
  // `color-scheme`, NOT according to the page's sheet. Without this line they appear
  // white in a dark theme, and no `option` rule helps against that —
  // author styles do not reach these windows. `light dark` would be wrong: that
  // would ask the operating system and drift apart as soon as someone uses a light
  // theme under a dark system.
  head.push('<style>body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }'
    + 'body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }</style>');
  if (opts.title) head.push(`<title>${escapeHtml(opts.title)}</title>`);
  for (const href of opts.styleUris ?? []) {
    head.push(`<link rel="stylesheet" href="${href}">`);
  }
  if (opts.css !== undefined) head.push(`<style>${opts.css}</style>`);

  const scripts: string[] = [];
  for (const d of opts.jsonData ?? []) {
    scripts.push(`<script type="application/json" id="${d.id}" nonce="${nonce}">${escapeScriptText(d.json)}</script>`);
  }
  const globalEntries = Object.entries(opts.globals ?? {});
  if (opts.exposeNonce) globalEntries.push(['__tm1Nonce', nonce]);
  if (globalEntries.length > 0) {
    const lines = globalEntries.map(([key, value]) => `  window.${key} = ${jsonForInlineScript(value)};`);
    scripts.push(`<script nonce="${nonce}">\n${lines.join('\n')}\n</script>`);
  }
  for (const src of opts.scriptUris ?? []) {
    scripts.push(`<script nonce="${nonce}" src="${src}"></script>`);
  }
  if (opts.inlineScript !== undefined) {
    scripts.push(`<script nonce="${nonce}">${opts.inlineScript}</script>`);
  }

  return `<!DOCTYPE html>
<html lang="${opts.lang ?? _uiLanguage}">
<head>
${head.join('\n')}
</head>
<body>
${opts.body}
${scripts.join('\n')}
</body>
</html>`;
}
