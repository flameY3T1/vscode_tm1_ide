import * as vscode from 'vscode';
import { CUBE_VIEWER_CSS } from './css';
import { getCubeViewerBody } from './htmlBody';
import { buildCubeViewerL10n } from './cubeViewerL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';

/**
 * Cube Viewer webview shell — loads the bundled `cubeViewerMonaco.js` from
 * `out/webview/`. CSS stays inline (matches the other Monaco shells); the
 * static body markup lives in `cubeViewer/htmlBody.ts`.
 *
 * The previous inline-`<script>` template was retired in P10 of the
 * cube-viewer Monaco-style migration.
 */
export function getCubeViewerHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'cubeViewerMonaco.js'),
  );
  const mdxPopupBundleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'mdxPopupEditor.js'),
  );
  const mdxPopupCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.css'),
  );
  const monacoVendorUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'monaco-vendor.js'),
  );
  const l10n = buildCubeViewerL10n();
  // 'auto' follows the OS locale — the same one Excel uses — via the extension
  // host's Intl (which reflects the OS, not the VS Code UI language), so a German
  // Excel gets a comma even when VS Code runs in English.
  const sepSetting = vscode.workspace
    .getConfiguration('tm1')
    .get<string>('cubeViewer.copyDecimalSeparator', 'auto');
  const copyDecimalComma = sepSetting === 'comma'
    || (sepSetting === 'auto' && new Intl.NumberFormat().format(1.1).includes(','));
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: 'TM1 Cube Viewer',
    css: CUBE_VIEWER_CSS,
    body: getCubeViewerBody(webview, extensionUri, l10n),
    globals: {
      __l10n: l10n,
      __tm1MdxPopupBundle: String(mdxPopupBundleUri),
      __tm1MdxPopupCss: String(mdxPopupCssUri),
      __tm1MonacoVendor: String(monacoVendorUri),
      __cvCopyDecimalComma: copyDecimalComma,
    },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
  });
}

