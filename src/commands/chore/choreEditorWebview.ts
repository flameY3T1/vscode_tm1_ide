import * as vscode from 'vscode';
import { CHORE_EDITOR_CSS } from './choreEditorCss';
import { buildChoreEditorBody } from './choreEditorBody';
import { buildChoreEditorL10n } from './choreEditorL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

/**
 * Chore Editor webview shell. Loads the bundled `out/webview/choreEditor.js`
 * via `webview.asWebviewUri` + nonce CSP.
 *
 * Post-H17 #7 split (2026-05-18): previously a 747-LOC monolith (CSS + body +
 * inline `<script>`). Pieces:
 *   - Types:  `choreEditorTypes.ts`     (interfaces)
 *   - CSS:    `choreEditorCss.ts`       (CHORE_EDITOR_CSS const)
 *   - Body:   `choreEditorBody.ts`      (buildChoreEditorBody, l10n-driven)
 *   - L10n:   `choreEditorL10n.ts`      (buildChoreEditorL10n map)
 *   - Script: `src/webviewClient/choreEditor/index.ts`
 *             (esbuild-bundled to `out/webview/choreEditor.js`)
 *
 * All dynamic data is loaded via postMessage after the panel opens.
 */
export function getChoreEditorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'choreEditor.js'),
  );
  const l10n = buildChoreEditorL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    viewport: true,
    title: 'Chore Editor',
    css: CHORE_EDITOR_CSS,
    body: buildChoreEditorBody(l10n),
    globals: { __l10n: l10n },
    scriptUris: [String(scriptUri)],
  });
}

