import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { DatasourceConfig, DATASOURCE_DEFAULTS } from '../datasource/types';
import { fetchViewNames, fetchSubsetNames, fetchCubeDimensions, fetchOdbcDataSources } from '../datasource/fetch';
// Leaf module, not the barrel: the barrel re-exports the vscode-bound fetchers.
import { toDatasourceConfig } from '../datasource/fromForm';
import { fetchNamesOrThrow } from '../../providers/fetchNames';
import { deployProcess } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { pickDeployTarget } from './deploy';
import { getServerConfig, getServerNameByUrl, getServerIdByUrl } from '../../serverState/state';
import { recordProcessOpen } from './recentBridge';
import type { ProcessEditorManager } from './manager';
import { buildWizardHtml, type WizardTemplate } from './newProcessWebview';
import {
  toApiDataSource,
  toApiParameters,
  toApiVariables,
  type NewProcessParamInput,
  type NewProcessVariableInput,
} from './newProcessPure';
import { ProcessTemplateStorage } from '../../processTemplates/processTemplateStorage';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview, WebviewToHost } from '../../webviewClient/newProcess/protocol';

interface NewProcessData {
  name: string;
  /** Selected template id from the wizard's first step; null = empty process. */
  templateId?: string | null;
  datasource: DatasourceConfig;
  params: NewProcessParamInput[];
  variables: NewProcessVariableInput[];
}

// ---------------------------------------------------------------------------
// Wizard WebView
// ---------------------------------------------------------------------------

const host = new WebviewPanelHost<WebviewToHost>('tm1NewProcess', 'New Process');

/**
 * A running number instead of a fixed key — as with the Area/DB builder and
 * the cube dialog. The server URL in front is the handle for
 * `disposePanelsForServer`: if the server is disconnected while the wizard is
 * open, it closes, and the waiting caller gets `undefined` instead of a
 * window that keeps asking against a dead server.
 */
let _seq = 0;

/** Closes all open "New Process" wizards for this server. */
export function disposeNewProcessForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

// Wizard: holds a `Tm1Config` in the closure and waits for input. On
// disconnect it closes, and the waiting caller gets `undefined` — instead
// of a form that asks against a dead server.
registerServerDisposer('newProcess', (url) => disposeNewProcessForServer(url));

async function showNewProcessWizard(
  config: Tm1Config, extensionUri: vscode.Uri, templates: WizardTemplate[] = [],
): Promise<NewProcessData | undefined> {
  let cubes: string[] = [];
  let dimensions: string[] = [];
  // The DSN list comes from the host the TM1 server runs on
  // (`GET SQLDataSources`, 11.2+). fetchOdbcDataSources swallows its own errors
  // and yields [], so an older server just leaves the datalist empty.
  let odbcDsns: string[] = [];
  try {
    [cubes, dimensions, odbcDsns] = await Promise.all([
      fetchNamesOrThrow('Cubes', config),
      fetchNamesOrThrow('Dimensions', config),
      fetchOdbcDataSources(config),
    ]);
  } catch (err) {
    // The wizard still works for ASCII/ODBC sources, so it opens anyway — but
    // empty cube/dimension lists used to look like "the server has none".
    void vscode.window.showWarningMessage(vscode.l10n.t('Could not load cubes and dimensions: {0}. Their lists in the wizard stay empty.', errMsg(err)));
  }

  return new Promise((resolve) => {
    let finished = false;
    host.initialize(extensionUri);
    // Without `viewColumn`: the wizard opens in the active group.
    // `retainContextWhenHidden` (host default) is a requirement here: the
    // wizard keeps its state only in the DOM — without it, VS Code discards
    // the content as soon as the panel becomes invisible, and everything
    // would have to be typed again.
    const panel = host.open({
      key: `${config.serverUrl}::newProcess#${++_seq}`,
      title: vscode.l10n.t('TM1: New Process'),
      html: (webview) => buildWizardHtml(cubes, dimensions, templates, odbcDsns, webview.cspSource, String(
        webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'newProcess.js')))),
      // Even when closed from the outside — for example because the server
      // was disconnected — the caller must come out of its `await`.
      onDispose: () => { if (!finished) { resolve(undefined); } },
      onMessage: async (msg) => {
        if (msg.command === 'cancel') {
          panel?.dispose();
          return;
        }
        if (msg.command === 'getViews') {
          const views = await fetchViewNames(msg.cube ?? '', config);
          void postTo<HostToWebview>(panel?.webview, { command: 'viewsLoaded', views });
          return;
        }
        if (msg.command === 'getSubsets') {
          const subsets = await fetchSubsetNames(msg.dimension ?? '', config);
          void postTo<HostToWebview>(panel?.webview, { command: 'subsetsLoaded', subsets });
          return;
        }
        if (msg.command === 'getCubeDimensions') {
          const dims = await fetchCubeDimensions(msg.cube ?? '', config);
          void postTo<HostToWebview>(panel?.webview, { command: 'cubeDimensionsLoaded', dimensions: dims });
          return;
        }
        if (msg.command === 'finish') {
          finished = true;
          const v = msg.data;

          const datasource = toDatasourceConfig({ ...v }, DATASOURCE_DEFAULTS);

          const params = (v.params ?? []).map((p): NewProcessParamInput => ({
            name: p.name,
            type: p.type === '1' ? 1 : 2,
            defaultValue: p.defaultValue ?? '',
            prompt: p.prompt ?? p.name,
          }));

          const variables = (v.variables ?? []).map((vr, idx): NewProcessVariableInput => ({
            name: vr.name,
            type: vr.type === '1' ? 1 : 2,
            position: parseInt(vr.position ?? String(idx + 1), 10) || (idx + 1),
            ...(vr.ignored ? { ignored: true } : {}),
          }));

          panel?.dispose();
          resolve({ name: v.name, templateId: v.templateId ?? null, datasource, params, variables });
        }
      },
    });
    if (!panel) { resolve(undefined); }
  });
}

// ---------------------------------------------------------------------------
// Command entrypoint
// ---------------------------------------------------------------------------

export async function newProcessCommand(
  editorManager: ProcessEditorManager,
  storage: ProcessTemplateStorage,
  extensionUri: vscode.Uri,
  node?: { meta?: { serverId?: string } },
): Promise<void> {
  const serverId = node?.meta?.serverId;
  const cfg = serverId ? getServerConfig(serverId) : await pickDeployTarget();
  if (!cfg) { return; } // user cancelled or unknown server

  const activeServerName = getServerNameByUrl(cfg.serverUrl) ?? cfg.serverUrl;
  const templates = storage.getFiltered(activeServerName);

  // Template selection is the wizard's first step (no separate QuickPick/panel).
  const data = await showNewProcessWizard(
    cfg,
    extensionUri,
    templates.map((t): WizardTemplate => ({ id: t.id, name: t.name, description: t.description })),
  );
  if (!data) { return; }

  let seedSections: { prolog: string; metadata: string; data: string; epilog: string } | undefined;
  if (data.templateId) {
    const tpl = storage.get(data.templateId);
    if (tpl) {
      seedSections = {
        prolog: tpl.source.PrologProcedure,
        metadata: tpl.source.MetadataProcedure,
        data: tpl.source.DataProcedure,
        epilog: tpl.source.EpilogProcedure,
      };
    }
  }

  try {
    const sections = seedSections ?? { prolog: '', metadata: '', data: '', epilog: '' };
    const dataSource = toApiDataSource(data.datasource);
    const parameters = toApiParameters(data.params);
    const variables = toApiVariables(data.variables);

    await deployProcess(data.name, sections, dataSource, parameters, variables, cfg);
    vscode.window.showInformationMessage(vscode.l10n.t('Process "{0}" created on the server.', data.name));

    await vscode.commands.executeCommand('tm1.refreshExplorer');

    // Open the editor with the same server context — otherwise openProcess
    // falls back to the default workspace config and 404s on a different
    // server.
    await editorManager.openProcess(data.name, undefined, cfg);
    // "Recently opened" is tied to the `tm1.openProcessEditor` command, not to
    // `openProcess` — whoever opens the editor directly must report it
    // themselves, otherwise the new process is missing from the list.
    recordProcessOpen(serverId ?? getServerIdByUrl(cfg.serverUrl), data.name);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not create process: {0}', errMsg(err)));
  }
}
