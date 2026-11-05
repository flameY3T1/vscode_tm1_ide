// src/commands/serverConfig/addServerWebview.ts
import * as vscode from 'vscode';
import { ADD_SERVER_CSS } from './addServerCss';
import { buildAddServerBody } from './addServerBody';
import { buildAddServerL10n } from './addServerL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'addServer.js'),
  );
  const l10n = buildAddServerL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: 'TM1 Server',
    viewport: true,
    css: ADD_SERVER_CSS,
    body: buildAddServerBody(l10n),
    globals: { __l10n: l10n },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
  });
}
