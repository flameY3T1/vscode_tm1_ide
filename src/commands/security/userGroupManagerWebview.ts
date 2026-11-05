// src/commands/security/userGroupManagerWebview.ts
import * as vscode from 'vscode';
import { USER_GROUP_MANAGER_CSS } from './userGroupManagerCss';
import { buildUserGroupManagerBody } from './userGroupManagerBody';
import { buildUserGroupManagerL10n } from './userGroupManagerL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../../webviews/columnResize';
import { savedColumnWidths } from '../../webviews/columnWidthStore';

export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'securityUserGroup.js'),
  );
  const l10n = buildUserGroupManagerL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: USER_GROUP_MANAGER_CSS + COLUMN_RESIZE_CSS,
    body: buildUserGroupManagerBody(l10n),
    globals: { __l10n: l10n },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
    inlineScript: columnResizeScript('userGroupManager', savedColumnWidths('userGroupManager')),
  });
}
