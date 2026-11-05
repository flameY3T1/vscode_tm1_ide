// src/commands/security/elementSecurityWebview.ts
import * as vscode from 'vscode';
import { SECURITY_MATRIX_CSS, MISSING_BANNER_CSS, buildSecurityMatrixBody } from './securityMatrixShell';
import { buildElementSecurityL10n } from './elementSecurityL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'securityElement.js'),
  );
  const l10n = buildElementSecurityL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: SECURITY_MATRIX_CSS + MISSING_BANNER_CSS,
    body: buildSecurityMatrixBody(l10n, {
      titleSuffix: ' <span id="dim-name">…</span>',
      afterTabs: `
<div id="missing-banner" class="missing-banner" style="display:none">
  <span id="missing-msg">${l10n.missingBanner}</span>
  <button id="btn-create" class="primary">${l10n.create}</button>
</div>
`,
    }),
    globals: { __l10n: l10n },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
  });
}
