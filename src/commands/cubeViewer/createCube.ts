import * as vscode from 'vscode';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { errMsg } from '../../utils/errMsg';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { createCube as createCubeApi } from '../../tm1Rest/cubeApi';
import { getServerConfig, getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { fetchNames, invalidateCache } from '../../providers/fetchNames';
import { encodeODataKey } from '../../utils/odataKey';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';
import type { CreateCubeBootstrap, HostToWebview, WebviewToHost } from '../../webviewClient/createCube/protocol';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_ ]{0,254}$/;

export function validateCubeName(raw: string, existingNames: string[]): string | undefined {
  const name = (raw ?? '').trim();
  if (!name) return vscode.l10n.t('Name must not be empty.');
  if (name.length > 255) return vscode.l10n.t('Name is too long (max. 255 characters).');
  if (!NAME_RE.test(name)) {
    return vscode.l10n.t('Name must start with a letter and may only contain letters, digits, underscore or spaces.');
  }
  const lower = name.toLowerCase();
  if (existingNames.some(n => n.toLowerCase() === lower)) {
    return vscode.l10n.t('Cube "{0}" already exists.', name);
  }
  return undefined;
}

export function validateCubeDims(selected: string[], available: string[]): string | undefined {
  if (selected.length < 2) return vscode.l10n.t('At least 2 dimensions are required.');
  const seen = new Set<string>();
  const avail = new Set(available);
  for (const d of selected) {
    if (!avail.has(d)) return vscode.l10n.t('Unknown dimension: "{0}"', d);
    if (seen.has(d)) return vscode.l10n.t('Duplicate dimension: "{0}"', d);
    seen.add(d);
  }
  return undefined;
}

// `Dimensions@odata.bind` values are RESOURCE PATHS (URI references), not OData
// literals — names therefore need quote-doubling AND URL-encoding (`encodeODataKey`).
// `Name`, by contrast, stays a plain property value and is transmitted raw.
export function buildCubeBody(name: string, dims: string[]): string {
  const bind = dims.map(d => `Dimensions('${encodeODataKey(d)}')`);
  return JSON.stringify({
    Name: name,
    'Dimensions@odata.bind': bind,
  });
}

export async function submitCubeCreate(
  name: string,
  dims: string[],
  cfg: Tm1Config,
  refreshTree: () => void,
): Promise<boolean> {
  try {
    await createCubeApi(cfg, buildCubeBody(name, dims), vscode.l10n.t('Could not create cube "{0}"', name));
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
    return false;
  }
  invalidateCache('Cubes', cfg.serverUrl);
  refreshTree();
  vscode.window.showInformationMessage(vscode.l10n.t('TM1: Cube "{0}" created.', name));
  return true;
}

export function getCreateCubeHtml(dimensions: string[], cspSource: string, scriptUri: string): string {
  return renderWebviewShell({
    cspSource,
    css: `
  html, body { height: 100%; }
  body {
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    padding: 12px; margin: 0; box-sizing: border-box;
    display: flex; flex-direction: column;
  }
  h1 { font-size: 1.1em; margin: 0 0 8px 0; flex-shrink: 0; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-shrink: 0; }
  .row label { min-width: 100px; }
  input[type="text"] {
    flex: 1; padding: 4px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px;
  }
  .lists { display: flex; gap: 8px; flex: 1; min-height: 0; }
  .col { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .col h2 { font-size: 0.9em; margin: 0 0 4px 0; opacity: 0.85; flex-shrink: 0; }
  .col input[type="text"] { flex: 0 0 auto; margin-bottom: 4px; }
  .ctrl-toggle {
    flex-shrink: 0; display: flex; align-items: center; gap: 4px;
    font-size: 0.85em; opacity: 0.85; margin-bottom: 4px; cursor: pointer;
  }
  ul {
    list-style: none; padding: 0; margin: 0;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    flex: 1; min-height: 120px; overflow-y: auto;
  }
  li {
    padding: 4px 8px; cursor: pointer;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: flex; align-items: center; gap: 6px;
  }
  li:hover { background: var(--vscode-list-hoverBackground); }
  li.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  .controls { display: flex; flex-direction: column; justify-content: center; gap: 4px; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-shrink: 0; }
  .err { color: var(--vscode-errorForeground); font-size: 0.85em; min-height: 1em; margin-top: 4px; flex-shrink: 0; }
  .order-badge { opacity: 0.6; font-size: 0.85em; min-width: 18px; text-align: right; }
`,
    body: `
<h1>${vscode.l10n.t('New Cube')}</h1>

<div class="row">
  <label for="cubeName">${vscode.l10n.t('Cube name:')}</label>
  <input id="cubeName" type="text" placeholder="${vscode.l10n.t('e.g. Sales')}">
</div>

<div class="lists">
  <div class="col">
    <h2>${vscode.l10n.t('Available dimensions')}</h2>
    <input id="dimFilter" type="text" placeholder="${vscode.l10n.t('Filter dimensions…')}">
    <label class="ctrl-toggle"><input id="ctrlToggle" type="checkbox"> ${vscode.l10n.t('Include control objects')}</label>
    <ul id="dimList"></ul>
  </div>
  <div class="controls">
    <button id="add" title="${vscode.l10n.t('Add')}">→</button>
    <button id="remove" title="${vscode.l10n.t('Remove')}">←</button>
    <button id="up" title="${vscode.l10n.t('Move up')}">↑</button>
    <button id="down" title="${vscode.l10n.t('Move down')}">↓</button>
  </div>
  <div class="col">
    <h2>${vscode.l10n.t('Cube axes (order)')}</h2>
    <ul id="selectedList"></ul>
  </div>
</div>

<div class="err" id="err"></div>

<div class="actions">
  <button id="cancel" class="secondary">${vscode.l10n.t('Cancel')}</button>
  <button id="submit" disabled>${vscode.l10n.t('Create cube')}</button>
</div>

`,
    globals: {
      __createCube: {
        dimensions,
        texts: { minDims: vscode.l10n.t('Select at least 2 dimensions.') },
      } satisfies CreateCubeBootstrap,
    },
    scriptUris: [scriptUri],
  });
}

/**
 * `retainContextWhenHidden: false` is deliberate: the dialog holds nothing
 * that would need to survive being clicked away — it is rebuilt on every open.
 *
 * A running number instead of a fixed key, as with the Area/DB Builder: a
 * wizard is not a one-off per object. The server URL up front is the handle
 * that `disposePanelsForServer` uses to find it on disconnect — previously
 * there was none, and the window stayed open along with its `cfg`.
 */
const host = new WebviewPanelHost<WebviewToHost>('tm1CreateCube', 'New Cube', {
  retainContextWhenHidden: false,
});

let _seq = 0;

/** Close all open "New Cube" dialogs for this server (on disconnect). */
export function disposeCreateCubeForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

// Wizard: holds a `Tm1Config` in the closure and waits for input. On
// disconnect it closes, and the waiting caller gets `undefined` — instead
// of a form that asks against a dead server.
registerServerDisposer('createCube', (url) => disposeCreateCubeForServer(url));

export async function createCubeCommand(
  node: any,
  refreshTree: () => void,
  extensionUri: vscode.Uri,
): Promise<void> {
  const cfg = getServerConfig(node?.meta?.serverId);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: No server connected.'));
    return;
  }

  const [dimensions, existingCubes] = await Promise.all([
    fetchNames('Dimensions', cfg).catch(() => [] as string[]),
    fetchNames('Cubes', cfg).catch(() => [] as string[]),
  ]);

  if (dimensions.length < 2) {
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: At least 2 Dimensions must exist to create a Cube.'));
    return;
  }

  const serverLabel = formatServerLabel(cfg.serverUrl, getServerNameByUrl);
  const panelTitle = serverLabel ? `${serverLabel} : ${vscode.l10n.t('New Cube')}` : vscode.l10n.t('New Cube');
  host.initialize(extensionUri);
  // Without `viewColumn`: the dialog opens in the currently active group and
  // so in the same window as the click that triggered it.
  const panel = host.open({
    key: `${cfg.serverUrl}::newCube#${++_seq}`,
    title: panelTitle,
    html: (webview) => getCreateCubeHtml(dimensions, webview.cspSource, String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'createCube.js')))),
    onMessage: async (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'cancel') {
        panel?.dispose();
        return;
      }
      if (msg.type === 'submit') {
        const name = String(msg.name ?? '').trim();
        const selDims: string[] = Array.isArray(msg.dimensions) ? msg.dimensions : [];

        const nameErr = validateCubeName(name, existingCubes);
        if (nameErr) {
          void postTo<HostToWebview>(panel?.webview, { type: 'validationError', message: nameErr });
          return;
        }
        const dimErr = validateCubeDims(selDims, dimensions);
        if (dimErr) {
          void postTo<HostToWebview>(panel?.webview, { type: 'validationError', message: dimErr });
          return;
        }
        const ok = await submitCubeCreate(name, selDims, cfg, refreshTree);
        if (ok) panel?.dispose();
      }
    },
  });
}
