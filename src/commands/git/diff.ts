import * as vscode from 'vscode';
import * as path from 'path';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { getServerConfig, getServerProfile, getGitProfile } from '../serverManager';
import { resolveServerGitDir, SERVER_DIFF_SCHEME } from '../../providers/serverConfigForFile';
import { sanitizeFilename } from '../../git/sanitize';
import { fetchProcess } from '../../git/processFetcher';
import { fetchRulesText } from '../../git/rulesApi';
import { serializeProcess } from '../../git/serializer';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { errMsg } from '../../utils/errMsg';

const SCHEME = SERVER_DIFF_SCHEME;

class ServerContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const segments = uri.path.split('/').filter(Boolean);
    if (segments.length < 3) { return '/* invalid URI */'; }
    const [serverId, kind, ...rest] = segments;
    const fileName = rest.join('/');
    const baseName = fileName.replace(/\.(ti|rux)$/, '');

    const config = getServerConfig(serverId);
    if (!config) { return `/* server profile "${serverId}" not connected */`; }

    try {
      if (kind === 'processes' && fileName.endsWith('.ti')) {
        const proc = await fetchProcess(baseName, config);
        return serializeProcess(proc).tiText;
      }
      if (kind === 'rules' && fileName.endsWith('.rux')) {
        return await fetchRulesText(baseName, config);
      }
      return '/* unknown URI shape */';
    } catch (err) {
      return `/* fetch error: ${errMsg(err)} */`;
    }
  }

  refresh(uri: vscode.Uri): void { this._onDidChange.fire(uri); }
}

let _provider: ServerContentProvider | null = null;

export function registerServerContentProvider(context: vscode.ExtensionContext): void {
  if (_provider) { return; }
  _provider = new ServerContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, _provider));
}

interface ResolvedDiff {
  localUri: vscode.Uri;
  serverUri: vscode.Uri;
  title: string;
}

function resolveDiffUris(
  config: Tm1Config,
  serverId: string,
  kind: 'processes' | 'rules',
  name: string,
): ResolvedDiff | null {
  const serverName = getServerProfile(serverId)?.name ?? serverId;
  const git = getGitProfile(serverId);
  if (!git || !git.enabled) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('TM1 Git: not enabled for server "{0}". Right-click the server → "Configure Git…".', serverName),
    );
    return null;
  }
  const ws = vscode.workspace.workspaceFolders?.[0];
  const serverDir = resolveServerGitDir(git, serverName, ws?.uri.fsPath ?? '');
  if (serverDir === null) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No workspace open.'));
    return null;
  }
  const ext = kind === 'processes' ? '.ti' : '.rux';
  const fileBase = sanitizeFilename(name);
  const localFsPath = path.join(serverDir, kind, `${fileBase}${ext}`);
  const localUri = vscode.Uri.file(localFsPath);
  const serverUri = vscode.Uri.parse(`${SCHEME}:/${serverId}/${kind}/${fileBase}${ext}`);
  return { localUri, serverUri, title: vscode.l10n.t('{0} (local ↔ {1})', name, serverName) };
}

export async function diffProcessCommand(node?: Tm1TreeNode): Promise<void> {
  const serverId = node?.meta?.serverId as string | undefined;
  const processName = node?.meta?.processName as string | undefined;
  if (!serverId || !processName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No process context.'));
    return;
  }
  const config = getServerConfig(serverId);
  if (!config) { return; }

  const d = resolveDiffUris(config, serverId, 'processes', processName);
  if (!d) { return; }
  if (_provider) { _provider.refresh(d.serverUri); }
  await vscode.commands.executeCommand('vscode.diff', d.localUri, d.serverUri, d.title);
}

export async function diffRulesCommand(node?: Tm1TreeNode): Promise<void> {
  const serverId = node?.meta?.serverId as string | undefined;
  const cubeName = node?.meta?.cubeName as string | undefined;
  if (!serverId || !cubeName) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Git: No cube context.'));
    return;
  }
  const config = getServerConfig(serverId);
  if (!config) { return; }

  const d = resolveDiffUris(config, serverId, 'rules', cubeName);
  if (!d) { return; }
  if (_provider) { _provider.refresh(d.serverUri); }
  await vscode.commands.executeCommand('vscode.diff', d.localUri, d.serverUri, d.title);
}
