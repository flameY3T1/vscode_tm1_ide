import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { fetchAll, save, type SaveError } from '../../serverConfig/configApi';
import { buildDiff } from '../../serverConfig/configDiff';
import { renderHtml } from './serverConfigEditorWebview';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

type ConfigMsg =
  | { type: 'reload' }
  | { type: 'save'; original?: unknown; edited?: unknown };

const host = new WebviewPanelHost<ConfigMsg>('tm1.serverConfig', 'TM1 Configuration');

/**
 * The key carries the server URL AT THE FRONT, separated by `::`.
 *
 * Not cosmetic: `WebviewPanelHost#disposePanelsForServer` closes exactly the
 * panels whose key is the URL or starts with `${url}::`. Before, the key
 * here was separated throughout by `|` — with that, disconnecting would
 * never have found the window, and it would have stayed open together with
 * `Tm1Config` in the closure.
 */
function keyOf(cfg: Tm1Config): string {
  return `${cfg.serverUrl}::${cfg.username}|${cfg.authType ?? 'Basic'}|${cfg.camNamespace ?? ''}`;
}

function formatSaveError(e: SaveError): string {
  if (e.target === 'validation') {
    return `Validierungsfehler${e.param ? ` [${e.param}]` : ''}: ${e.message}`;
  }
  return `PATCH ${e.target} HTTP ${e.statusCode}: ${e.message}`;
}

async function safeReload(panel: vscode.WebviewPanel, isDisposed: () => boolean, cfg: Tm1Config, serverName: string, extensionUri: vscode.Uri): Promise<void> {
  try {
    const fresh = await fetchAll(cfg);
    if (isDisposed()) { return; }
    panel.webview.html = renderHtml(fresh, serverName, panel.webview, extensionUri);
  } catch (err) {
    if (!isDisposed()) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to load configuration: {0}', errMsg(err)));
    }
  }
}

export function _resetForTest(): void { host.disposeAll(); }

/** Close all configuration windows of this server (when disconnecting). */
export function disposeServerConfigPanelsForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('serverConfigEditor', (url) => disposeServerConfigPanelsForServer(url));

export async function openServerConfigEditor(cfg: Tm1Config, serverName: string, extensionUri?: vscode.Uri): Promise<void> {
  // extensionUri is required for icon assets but kept optional in the signature so
  // existing tests (which don't render HTML to a real DOM) keep working. If absent
  // we synthesize a benign empty URI — renderHtml gracefully handles missing assets.
  const uri = extensionUri ?? vscode.Uri.file('/');
  // The host needs to know a root once. Here rather than in `extension.ts`,
  // because this module gets its root passed in on every call anyway, and
  // the fallback root above must work without a caller.
  host.initialize(uri);

  const key = keyOf(cfg);
  let disposed = false;
  const isDisposed = () => disposed;

  const panel = host.open({
    key,
    title: vscode.l10n.t('TM1 Configuration — {0}', serverName),
    // Empty when opening: the content is only produced after `fetchAll`,
    // and that was the same before — the panel stood without HTML until
    // the first load.
    html: () => '',
    onDispose: () => { disposed = true; },
    onMessage: async (msg) => {
      if (!msg || typeof msg !== 'object') { return; }
      if (msg.type === 'reload') {
        await safeReload(panel!, isDisposed, cfg, serverName, uri);
        return;
      }
      if (msg.type === 'save') {
        const origRaw = msg.original;
        const editedRaw = msg.edited;
        if (!origRaw || typeof origRaw !== 'object' || !editedRaw || typeof editedRaw !== 'object') {
          vscode.window.showErrorMessage(vscode.l10n.t('Invalid save message from webview.'));
          return;
        }
        const orig = new Map<string, unknown>(Object.entries(origRaw as Record<string, unknown>));
        const edited = new Map<string, unknown>(Object.entries(editedRaw as Record<string, unknown>));
        const diff = buildDiff(orig, edited);
        if (diff.length === 0) {
          vscode.window.showInformationMessage(vscode.l10n.t('No changes.'));
          return;
        }
        const detail = diff.map(d => `[${d.name}] ${String(d.oldValue)} → ${String(d.newValue)}`).join('\n');
        const saveLabel = vscode.l10n.t('Save');
        const choice = await vscode.window.showInformationMessage(
          vscode.l10n.t('Change {0} parameter(s)?', String(diff.length)), { modal: true, detail }, saveLabel,
        );
        if (choice !== saveLabel || isDisposed()) { return; }
        const editsMap = new Map(diff.map(d => [d.name, d.newValue]));
        try {
          // Re-fetch snapshot for routing hint (nested keys need to know their source endpoint).
          const snap = await fetchAll(cfg);
          if (isDisposed()) { return; }
          const result = await save(cfg, editsMap, { staticKeys: snap.staticKeys, activeKeys: snap.activeKeys, paths: snap.paths, values: snap.values });
          for (const e of result.errors) {
            vscode.window.showErrorMessage(formatSaveError(e));
          }
          if (result.restartNeeded.length > 0) {
            vscode.window.showWarningMessage(vscode.l10n.t('Restart required for: {0}', result.restartNeeded.join(', ')));
          }
        } catch (err) {
          vscode.window.showErrorMessage(vscode.l10n.t('Save failed: {0}', errMsg(err)));
        }
        await safeReload(panel!, isDisposed, cfg, serverName, uri);
      }
    },
  });

  // `null` means: a window was already standing under this key, and the
  // host brought it to the front. Then there is nothing left to load here.
  if (!panel) { return; }

  // Initial load — guarded against disposal during await.
  await safeReload(panel, isDisposed, cfg, serverName, uri);
}
