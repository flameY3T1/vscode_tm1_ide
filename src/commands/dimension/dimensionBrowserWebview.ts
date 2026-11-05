import * as vscode from 'vscode';
import { DIMENSION_BROWSER_CSS } from './dimensionBrowserCss';
import { buildDimensionBrowserBody } from './dimensionBrowserBody';
import { buildDimensionBrowserL10n } from './dimensionBrowserL10n';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { makeIconRenderer } from '../../webviews/webviewIcons';

/**
 * Dimension Browser webview shell. Loads the bundled
 * `out/webview/dimensionBrowser.js` via `webview.asWebviewUri` + nonce CSP.
 *
 * The previous monolithic 1598-LOC template (CSS + body + inline `<script>`)
 * was split in Hebel 2 — see `MEMORY.md`. Pieces:
 *   - CSS:    `dimensionBrowserCss.ts`     (DIMENSION_BROWSER_CSS const)
 *   - Body:   `dimensionBrowserBody.ts`    (DIMENSION_BROWSER_BODY const)
 *   - Script: `src/webviewClient/dimensionBrowser/index.ts`
 *             (esbuild-bundled to `out/webview/dimensionBrowser.js`)
 *
 * All dynamic data is loaded via postMessage after the panel opens.
 */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'dimensionBrowser.js'),
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
  const l10n = buildDimensionBrowserL10n();
  // Toolbar glyphs come from the shared explorer icon set; `localResourceRoots`
  // in `dimensionBrowser.ts` already includes `<extensionUri>/media`.
  const icon = makeIconRenderer(webview, extensionUri);
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: DIMENSION_BROWSER_CSS,
    body: buildDimensionBrowserBody(l10n, (name) => icon(name)),
    globals: {
      __l10n: l10n,
      __tm1MdxPopupBundle: String(mdxPopupBundleUri),
      __tm1MdxPopupCss: String(mdxPopupCssUri),
      __tm1MonacoVendor: String(monacoVendorUri),
    },
    exposeNonce: true,
    scriptUris: [String(scriptUri)],
  });
}

