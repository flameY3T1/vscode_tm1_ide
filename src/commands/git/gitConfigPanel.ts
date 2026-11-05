import * as vscode from 'vscode';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { buildGitConfigBody } from './gitConfigPanelBody';
import {
  getServerProfile, getGitProfile, updateServerGit, GIT_DEFAULTS,
} from '../serverManager';

type GitConfigMsg =
  | { type: 'save'; enabled: boolean; repoPath: string; parallelFetch: number; includeServerFolder: boolean };

const host = new WebviewPanelHost<GitConfigMsg>('tm1.gitConfig', 'GitConfig');

export function initializeGitConfigPanel(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

const CSS = `
  body { padding: 12px; font-family: var(--vscode-font-family); }
  .form { max-width: 520px; }
  .row { display: block; margin: 10px 0; }
  button { padding: 4px 14px; }
`;


export async function openGitConfigPanel(serverId: string): Promise<void> {
  const profile = getServerProfile(serverId);
  if (!profile) {
    vscode.window.showErrorMessage(vscode.l10n.t('Server profile "{0}" not found.', serverId));
    return;
  }
  if (host.reveal(serverId)) { return; }

  const git = getGitProfile(serverId) ?? { ...GIT_DEFAULTS };
  const title = vscode.l10n.t('Git: {0}', profile.name);

  host.open({
    key: serverId,
    title,
    html: (webview, extensionUri) => renderWebviewShell({
      cspSource: webview.cspSource,
      title,
      css: CSS,
      body: buildGitConfigBody(),
      globals: { __GIT_INIT__: git },
      scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'gitConfig.js')))],
    }),
    onMessage: async (msg) => {
      if (msg.type === 'save') {
        const parallelFetch = Math.max(1, Math.floor(Number(msg.parallelFetch) || 8));
        const repoPath = (msg.repoPath || '').trim() || GIT_DEFAULTS.repoPath;
        await updateServerGit(serverId, { enabled: !!msg.enabled, repoPath, parallelFetch, includeServerFolder: !!msg.includeServerFolder });
        vscode.window.showInformationMessage(vscode.l10n.t('Git settings saved for "{0}".', profile.name));
        host.get(serverId)?.dispose();
      }
    },
  });
}
