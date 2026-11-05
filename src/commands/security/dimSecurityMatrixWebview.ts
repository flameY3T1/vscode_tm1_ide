// src/commands/security/dimSecurityMatrixWebview.ts
import * as vscode from 'vscode';
import { SECURITY_MATRIX_CSS, buildSecurityMatrixBody } from './securityMatrixShell';
import { buildSecurityMatrixL10n } from './securityMatrixL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'securityDimMatrix.js'),
  );
  const l10n = buildSecurityMatrixL10n({
    title: vscode.l10n.t('Dimension Security'),
    entityLabel: vscode.l10n.t('Dimension'),
    entityLabelPlural: vscode.l10n.t('dimensions'),
  });
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: SECURITY_MATRIX_CSS,
    body: buildSecurityMatrixBody(l10n),
    globals: { __l10n: l10n },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
  });
}
