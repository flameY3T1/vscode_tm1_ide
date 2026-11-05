import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../../webviews/columnResize';
import { savedColumnWidths } from '../../webviews/columnWidthStore';
import { CELL_TRACE_CSS } from './cellTraceCss';
import { buildCellTraceBody } from './cellTraceBody';
import { buildCellTraceL10n } from './cellTraceL10n';

export function getCellTraceHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'cellTrace.js'),
  );
  const l10n = buildCellTraceL10n();
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: CELL_TRACE_CSS + COLUMN_RESIZE_CSS,
    body: buildCellTraceBody(l10n),
    globals: { __l10n: l10n },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
    inlineScript: columnResizeScript('cellTrace', savedColumnWidths('cellTrace')),
  });
}
