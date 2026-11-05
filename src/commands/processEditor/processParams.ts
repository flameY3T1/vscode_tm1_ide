import * as vscode from 'vscode';
import { loadLastParams, saveLastParams } from '../paramMemory';
import { buildFormHtmlStyled, type ParamFormLabels } from './processParamsPure';
import { parseParametersFromFileContent, type TiParam } from '../../utils/proFile';

/** Translate the parameter form's chrome — the pure builder may not use vscode.l10n. */
function paramFormLabels(count: number): ParamFormLabels {
  return {
    cancel: vscode.l10n.t('Cancel'),
    paramCount: vscode.l10n.t('{0} Parameters', String(count)),
    lang: vscode.env.language,
  };
}
import { getNonce } from '../../utils/nonce';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { getExtensionContext } from '../../utils/extensionContext';
import { postTo } from '../../webviews/typedPost';
import type { ParamAsk } from '../../webviewClient/_shared/paramPromptProtocol';

/** Extension root; '/' only before activation (unit tests), where no bundle loads anyway. */
const extensionRoot = (): vscode.Uri => getExtensionContext()?.extensionUri ?? vscode.Uri.file('/');

type ParamMsg = { command?: string; values?: Record<string, string> };

/**
 * Two kinds of windows, two hosts — the kind (`viewType`) belongs to the
 * host, not to the individual call.
 *
 * Both carry a running number behind the server URL instead of a fixed key:
 * a parameter form is a wizard, not a single instance per process, and two
 * forms open at the same time are allowed. The URL in front is the handle
 * for `disposePanelsForServer` — there used to be none, and an open form
 * survived the disconnect while the caller kept waiting on it.
 */
const localHost  = new WebviewPanelHost<ParamMsg>('tm1Params', 'Parameters');
const serverHost = new WebviewPanelHost<ParamMsg>('tm1ServerParams', 'Parameters');
let _seq = 0;

/** Closes all open parameter forms for this server (on disconnect). */
export function disposeParamFormsForServer(serverUrl: string): void {
  localHost.disposePanelsForServer(serverUrl);
  serverHost.disposePanelsForServer(serverUrl);
}

// Wizard: holds a `Tm1Config` in the closure and waits for input. On
// disconnect it closes, and the waiting caller gets `undefined` — instead
// of a form that asks against a dead server.
registerServerDisposer('paramForms', (url) => disposeParamFormsForServer(url));

export { parseParametersFromFileContent, type TiParam };

/**
 * Shows a WebView form for all parameters.
 * On OK: writes updated default values back to the .pro file (590,N block),
 *        then returns the TM1 API Parameters array.
 * On Cancel: returns undefined.
 */
export async function showParameterForm(
  processName: string,
  params: TiParam[],
  document: vscode.TextDocument,
  serverUrl: string = '',
): Promise<Array<{ Name: string; Value: string | number }> | undefined> {
  if (params.length === 0) { return []; }

  // Pre-fill from last-used values (server+process scoped); fall back to .pro default.
  const remembered = loadLastParams(serverUrl, processName);
  const paramsForForm: TiParam[] = params.map(p => ({
    ...p,
    Value: Object.prototype.hasOwnProperty.call(remembered, p.Name) ? remembered[p.Name] : p.Value,
  }));

  return new Promise((resolve) => {
    let submitted = false;
    // The real root: the form loads its script bundle from out/webview/.
    localHost.initialize(extensionRoot());
    // Without `viewColumn`: the form opens in the active group.
    // `retainContextWhenHidden` (host default) is a requirement here —
    // otherwise VS Code tears down the webview as soon as its tab goes into
    // the background, and rebuilds the original HTML on return: everything
    // typed would be back at the default values.
    const panel = localHost.open({
      key: `${serverUrl}::params#${++_seq}`,
      title: vscode.l10n.t('Parameters: {0}', processName),
      html: (webview, extensionUri) => buildFormHtmlStyled(processName, paramsForForm, vscode.l10n.t('Execute'), {
        nonce: getNonce(),
        cspSource: webview.cspSource,
        scriptUri: String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'paramForm.js'))),
      }, paramFormLabels(paramsForForm.length)),
      onDispose: () => { if (!submitted) { resolve(undefined); } },
      onMessage: async (msg) => {
        if (msg.command === 'cancel') {
          panel?.dispose();
          resolve(undefined);
          return;
        }
        if (msg.command === 'submit') {
          submitted = true;
          const values: Record<string, string> = msg.values ?? {};
          const result = params.map(p => ({
            Name: p.Name,
            Value: p.Type === 1 ? (parseFloat(values[p.Name]) || 0) : (values[p.Name] ?? p.Value),
          }));
          panel?.dispose();
          await updateDefaultsInFile(document, params, values);
          await saveLastParams(serverUrl, processName, values);
          resolve(result);
        }
      },
    });
    if (!panel) { resolve(undefined); }
  });
}

/** Updates the 590,N block in the .pro file with new default values. */
async function updateDefaultsInFile(
  document: vscode.TextDocument,
  params: TiParam[],
  values: Record<string, string>,
): Promise<void> {
  const content = document.getText();
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));

  // Find the 590,N block boundaries
  let blockStart = -1;
  let blockEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^590,(\d+)$/);
    if (m) {
      blockStart = i;
      blockEnd = i + parseInt(m[1], 10);
      break;
    }
  }

  // Build new 590 block lines
  const newBlock = [
    `590,${params.length}`,
    ...params.map(p => {
      const val = values[p.Name] ?? p.Value;
      return p.Type === 2 ? `${p.Name},"${val}"` : `${p.Name},${val}`;
    }),
  ];

  let newLines: string[];
  if (blockStart !== -1) {
    newLines = [...lines.slice(0, blockStart), ...newBlock, ...lines.slice(blockEnd + 1)];
  } else {
    // No 590 block exists — insert before 572 (Prolog)
    const prologIdx = lines.findIndex(l => /^572,/.test(l));
    const insertAt = prologIdx === -1 ? lines.length : prologIdx;
    newLines = [...lines.slice(0, insertAt), ...newBlock, ...lines.slice(insertAt)];
  }

  const newContent = newLines.join('\r\n');
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(content.length),
  );
  edit.replace(document.uri, fullRange, newContent);
  await vscode.workspace.applyEdit(edit);
}


type ApiParam = { Name: string; Type: string; Value: string | number; Prompt: string };
type ParamResult = Array<{ Name: string; Value: string | number }>;

/** Server parameters for a form, prefilled with what was entered last time for this process. */
function serverFormParams(apiParams: ApiParam[], serverUrl: string, processName: string): TiParam[] {
  const remembered = loadLastParams(serverUrl, processName);
  return apiParams.map(p => ({
    Name: p.Name,
    Type: p.Type === 'Numeric' ? 1 : 2,
    Value: Object.prototype.hasOwnProperty.call(remembered, p.Name) ? remembered[p.Name] : String(p.Value),
    Prompt: p.Prompt || p.Name,
  }));
}

function formResult(params: TiParam[], values: Record<string, string>): ParamResult {
  return params.map(p => ({
    Name: p.Name,
    Value: p.Type === 1 ? (parseFloat(values[p.Name]) || 0) : (values[p.Name] ?? p.Value),
  }));
}

/** Open overlay prompts per request id; `paramsAnswer` from the editor resolves them. */
const pendingAsks = new Map<string, (values: Record<string, string> | null) => void>();

/** Called by the message handler of a prompting window (process editor, coverage) for `paramsAnswer`. */
export function answerParamAsk(requestId: string, values: Record<string, string> | null): void {
  pendingAsks.get(requestId)?.(values);
}

/**
 * The parameter prompt as an overlay INSIDE the window the run was started
 * from (process editor, coverage), instead of a separate tab (user feedback,
 * 2026-10-28: a second tab for the prompt is counter-intuitive). The window
 * must render `_shared/paramPrompt.ts` on `askParams`. Same prefill and
 * memory as `showServerParameterForm`. Undefined on cancel or when the
 * window is closed while asking.
 */
export async function askParamsInPanel(
  panel: vscode.WebviewPanel,
  processName: string,
  apiParams: ApiParam[],
  submitLabel: string,
  serverUrl: string,
): Promise<ParamResult | undefined> {
  if (apiParams.length === 0) { return []; }
  const params = serverFormParams(apiParams, serverUrl, processName);
  const requestId = `${Date.now()}-${++_seq}`;
  const values = await new Promise<Record<string, string> | null>((resolve) => {
    const closed = panel.onDidDispose(() => finish(null));
    function finish(v: Record<string, string> | null): void {
      pendingAsks.delete(requestId);
      closed.dispose();
      resolve(v);
    }
    pendingAsks.set(requestId, finish);
    void postTo<ParamAsk>(panel.webview, {
      type: 'askParams',
      requestId,
      title: vscode.l10n.t('Parameters: {0}', processName),
      submitLabel,
      cancelLabel: vscode.l10n.t('Cancel'),
      params: params.map(p => ({ name: p.Name, numeric: p.Type === 1, value: String(p.Value ?? ''), prompt: p.Prompt === p.Name ? '' : p.Prompt })),
    });
  });
  if (values === null) { return undefined; }
  await saveLastParams(serverUrl, processName, values);
  return formResult(params, values);
}

/**
 * Shows a parameter form for a server-side process (no local .pro file).
 * Loads parameters from the TM1 REST API, shows a styled form, and returns
 * the parameter values on submit. Returns undefined on cancel.
 */
export async function showServerParameterForm(
  processName: string,
  apiParams: ApiParam[],
  buttonLabel: string,
  serverUrl: string,
): Promise<ParamResult | undefined> {
  if (apiParams.length === 0) { return []; }

  const params = serverFormParams(apiParams, serverUrl, processName);

  return new Promise((resolve) => {
    let submitted = false;
    serverHost.initialize(extensionRoot());
    // As with `showParameterForm`: no fixed column, and
    // `retainContextWhenHidden` keeps what was typed across a tab switch.
    const panel = serverHost.open({
      key: `${serverUrl}::params#${++_seq}`,
      title: vscode.l10n.t('Parameters: {0}', processName),
      html: (webview, extensionUri) => buildFormHtmlStyled(processName, params, buttonLabel, {
        nonce: getNonce(),
        cspSource: webview.cspSource,
        scriptUri: String(webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'paramForm.js'))),
      }, paramFormLabels(params.length)),
      onDispose: () => { if (!submitted) { resolve(undefined); } },
      onMessage: async (msg) => {
        if (msg.command === 'cancel') {
          panel?.dispose();
          resolve(undefined);
          return;
        }
        if (msg.command === 'submit') {
          submitted = true;
          const values: Record<string, string> = msg.values ?? {};
          panel?.dispose();
          await saveLastParams(serverUrl, processName, values);
          resolve(formResult(params, values));
        }
      },
    });
    if (!panel) { resolve(undefined); }
  });
}
