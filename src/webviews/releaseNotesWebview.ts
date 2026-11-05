import * as vscode from 'vscode';
import { muteWebviewOnDispose } from './webviewPanelHost';
import { marked } from 'marked';
import { renderWebviewShell } from './webviewShell';
import { extractVersionSection } from '../commands/releaseNotes/changelog';

export const RELEASE_NOTES_CSS = [
  'body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); margin: 0; padding: 0; }',
  '.rn { max-width: 820px; margin: 0 auto; padding: 16px 24px 48px; line-height: 1.55; }',
  '.rn h1 { font-size: 20px; }',
  '.rn h2 { font-size: 17px; margin-top: 4px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 6px; }',
  '.rn h3 { font-size: 14px; margin: 18px 0 6px; }',
  '.rn ul { padding-left: 20px; }',
  '.rn li { margin: 3px 0; }',
  '.rn code { font-family: var(--vscode-editor-font-family, monospace); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }',
  '.rn a { color: var(--vscode-textLink-foreground); }',
  '.rn img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }',
].join('\n');

/** Rewrites relative <img src> to webview URIs; leaves http(s)/data URIs alone. */
function rewriteImages(html: string, webview: vscode.Webview, extensionUri: vscode.Uri): string {
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (whole, pre, src, post) => {
    if (/^(https?:|data:)/i.test(src)) { return whole; }
    const rel = src.replace(/^\.?\//, '');
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, rel));
    return `${pre}${uri.toString()}${post}`;
  });
}

export class ReleaseNotesPanel {
  private static panel: vscode.WebviewPanel | undefined;

  static async show(extensionUri: vscode.Uri, version: string): Promise<void> {
    const title = vscode.l10n.t("What's New: {0}", version);
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'tm1.releaseNotes', title, vscode.ViewColumn.Active,
        // Only media/ needs webview-resource access (changelog images); the
        // CHANGELOG.md itself is read via workspace.fs, not as a webview URI.
        { enableScripts: false, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] },
      );
      muteWebviewOnDispose(this.panel);
      this.panel.onDidDispose(() => { ReleaseNotesPanel.panel = undefined; });
    }
    const panel = this.panel;
    const webview = panel.webview;

    let md = '';
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extensionUri, 'CHANGELOG.md'));
      md = Buffer.from(bytes).toString('utf8');
    } catch { /* no changelog → fallback below */ }

    const section = md ? extractVersionSection(md, version) : null;
    const bodyMd = section ?? vscode.l10n.t('No release notes available.');
    const rawHtml = await marked.parse(bodyMd);
    const html = rewriteImages(rawHtml, webview, extensionUri);

    webview.html = renderWebviewShell({
      cspSource: webview.cspSource,
      css: RELEASE_NOTES_CSS,
      body: `<div class="rn">${html}</div>`,
    });
  }
}
