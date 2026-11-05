import * as vscode from 'vscode';
import { DIMENSION_EDITOR_CSS } from './dimensionEditorCss';
import { buildDimensionEditorBody } from './dimensionEditorBody';
import { buildDimensionEditorL10n } from './dimensionEditorL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

/**
 * Dimension Editor webview shell (v1.6.0). Loads the bundled
 * `out/webview/dimensionEditor.js` via `webview.asWebviewUri` + nonce CSP.
 *
 * The previous monolithic 1301-LOC template (CSS + body + inline `<script>`)
 * was split in Hebel 2 — see MEMORY.md. Pieces:
 *   - CSS:    `dimensionEditorCss.ts`     (DIMENSION_EDITOR_CSS const)
 *   - Body:   `dimensionEditorBody.ts`    (DIMENSION_EDITOR_BODY const)
 *   - Script: `src/webviewClient/dimensionEditor/index.ts`
 *             (esbuild-bundled to `out/webview/dimensionEditor.js`)
 *
 * Manager populates content via postMessage after the panel opens.
 */
export function getDimensionEditorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'dimensionEditor.js'),
  );
  const l10n = buildDimensionEditorL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: DIMENSION_EDITOR_CSS,
    body: buildDimensionEditorBody(l10n),
    globals: { __l10n: l10n },
    scriptUris: [String(scriptUri)],
  });
}

