import * as vscode from 'vscode';
import { fetchLatestBedrockRelease, bedrockEditionFor, httpsJsonFetcher, httpsZipFetcher } from '../../bedrock/bedrockRelease';
import { loadBedrockManifestFor } from '../../bedrock/bedrockManifest';
import { installBedrockManifest } from '../../bedrock/bedrockInstaller';
import { getServerConfig } from '../../serverState/state';
import { upsertProcess } from '../../tm1Rest/processApi';
import { setBedrockInstalled } from '../../bedrock/bedrockStateCache';
import { errMsg } from '../../utils/errMsg';

export async function installBedrock(node?: { meta?: { serverId?: string } }): Promise<void> {
  const serverId = node?.meta?.serverId;
  if (!serverId) { vscode.window.showErrorMessage(vscode.l10n.t('Run this from a server context menu.')); return; }
  const cfg = getServerConfig(serverId);
  if (!cfg) { vscode.window.showErrorMessage(vscode.l10n.t('Server configuration not found.')); return; }

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Install Bedrock'), cancellable: false },
      async progress => {
        // Bedrock 4 belongs on TM1 11.x, Bedrock 5 on TM1 Database 12 — two
        // repos, two package formats. The choice depends on the connected database.
        const edition = bedrockEditionFor(cfg);
        progress.report({ message: vscode.l10n.t('Fetching latest release info from GitHub…') });
        const rel = await fetchLatestBedrockRelease(httpsJsonFetcher, edition);
        progress.report({ message: vscode.l10n.t('Downloading {0}…', rel.tag) });
        const zipBuf = await httpsZipFetcher(rel.zipballUrl);
        progress.report({ message: 'Parse Manifest…' });
        const manifest = await loadBedrockManifestFor(edition, zipBuf);
        if (manifest.length === 0) { throw new Error(vscode.l10n.t('Bedrock release contains no process definitions.')); }
        const result = await installBedrockManifest(
          cfg, manifest,
          async (c, name, payload) => { await upsertProcess(c, name, payload); },
          p => progress.report({ message: `${p.done}/${p.total}: ${p.current}`, increment: 100 / p.total }),
        );
        setBedrockInstalled(serverId, true);
        const msg = result.failed.length
          ? vscode.l10n.t('Bedrock {0}: {1} processes installed, {2} failed.', rel.tag, result.installed, result.failed.length)
          : vscode.l10n.t('Bedrock {0}: {1} processes installed.', rel.tag, result.installed);
        if (result.failed.length) {
          vscode.window.showWarningMessage(msg + '\n\n' + vscode.l10n.t('Errors: {0}', result.failed.map(f => `${f.name}: ${f.error}`).join('\n')));
        } else {
          vscode.window.showInformationMessage(msg);
        }
        await vscode.commands.executeCommand('tm1.refreshExplorer');
      },
    );
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Bedrock installation failed: {0}', errMsg(err)));
  }
}
