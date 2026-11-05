// src/commands/security/cubeSecurityMatrixWebview.ts
import * as vscode from 'vscode';
import { SECURITY_MATRIX_CSS, buildSecurityMatrixBody } from './securityMatrixShell';
import { buildSecurityMatrixL10n } from './securityMatrixL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'securityCubeMatrix.js'),
  );
  const l10n = buildSecurityMatrixL10n({
    title: vscode.l10n.t('Cube Security'),
    entityLabel: vscode.l10n.t('Cube'),
    entityLabelPlural: vscode.l10n.t('cubes'),
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
