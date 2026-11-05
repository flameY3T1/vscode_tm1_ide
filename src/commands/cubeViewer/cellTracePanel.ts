import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { errMsg } from '../../utils/errMsg';
import { traceRule, traceFeeders, checkFeeders } from '../../tm1Rest/cellTraceApi';
import type { TracePanelIn, TracePanelOut } from '../../webviewClient/cellTrace/protocol';
import { getCellTraceHtml } from './cellTracePanelHtml';
import { rememberColumnWidths } from '../../webviews/columnWidthStore';
import { fetchRules, RuleEditorManager } from '../rule/ruleEditor';
import { getCubeDimensionNames } from '../../tm1Rest/cubeApi';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

let _extensionUri: vscode.Uri | null = null;
const _panels = new Map<string, vscode.WebviewPanel>();
// Race guard: overlapping traces on the same cell (e.g. "Trace rule" then
// "Check feeders" while the first is in flight) must not let the SLOWER
// response overwrite the panel. Globally monotonic counter; per panel-key we
// remember the newest request — anything older drops its response silently.
let _reqCounter = 0;
const _activeReq = new Map<string, number>();

export function initializeCellTracePanel(extensionUri: vscode.Uri): void {
  _extensionUri = extensionUri;
}

export function disposeCellTracePanelsForServer(serverUrl: string): void {
  for (const [key, panel] of _panels) {
    if (key.startsWith(`${serverUrl} `)) { panel.dispose(); }
  }
}

registerServerDisposer('cellTrace', (url) => disposeCellTracePanelsForServer(url));

export interface OpenTraceArgs {
  kind: 'rule' | 'feeders' | 'check';
  cube: string;
  dims: string[];
  coords: string[];
  config: Tm1Config;
}

export async function openCellTracePanel(args: OpenTraceArgs): Promise<void> {
  if (!_extensionUri) { throw new Error('cellTracePanel not initialized'); }
  const { kind, cube, dims, coords, config } = args;
  const key = `${config.serverUrl} ${cube} ${coords.join('|')}`;
  const seq = ++_reqCounter;
  _activeReq.set(key, seq);

  let panel = _panels.get(key);
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'tm1CellTrace',
      `TM1 Trace — ${cube}`,
      // ViewColumn: deliberate
      // `Beside` on purpose: the trace belongs NEXT TO the cube viewer it
      // came from — you compare the cell and its derivation side by side.
      // Unlike `One`, `Beside` is relative to the active group and so stays
      // within the same window; that is why there is NO switch to `Active`
      // here.
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(_extensionUri, 'out'),
          vscode.Uri.joinPath(_extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, 'tm1CellTrace');
    muteWebviewOnDispose(panel);
    panel.webview.html = getCellTraceHtml(panel.webview, _extensionUri);
    rememberColumnWidths(panel, 'cellTrace');
    _panels.set(key, panel);
    let disposed = false;
    panel.onDidDispose(() => {
      disposed = true;
      _panels.delete(key);
      _activeReq.delete(key); // in-flight responses for this key drop silently
    });
    // Captured at creation time: panels are keyed per server+cube+coords, so
    // re-opens with the same key always carry the same server config.
    // Dimensions per cube, for tracing a child that lives in another cube.
    const cubeDims = new Map<string, Promise<string[]>>([[cube, Promise.resolve(dims)]]);
    const p = panel;
    panel.webview.onDidReceiveMessage(async (msg: TracePanelOut) => {
      if (msg?.type === 'expand') {
        try {
          let d = cubeDims.get(msg.cube);
          if (!d) { d = getCubeDimensionNames(config, msg.cube); cubeDims.set(msg.cube, d); }
          const childDims = await d;
          const node = await traceRule(msg.cube, childDims, msg.coords, config);
          if (disposed) { return; }
          void postTo<TracePanelIn>(p.webview, { type: 'children', id: msg.id, node, dims: childDims } satisfies TracePanelIn);
        } catch (err) {
          cubeDims.delete(msg.cube);
          if (disposed) { return; }
          void postTo<TracePanelIn>(p.webview, { type: 'childrenError', id: msg.id, message: errMsg(err) } satisfies TracePanelIn);
        }
      } else if (msg?.type === 'openRule') {
        await RuleEditorManager.open(msg.cube, config, msg.line);
      } else if (msg?.type === 'switchMode') {
        // The panel key is cube+coords, so the SAME cell is re-traced in the
        // requested mode and lands back in this panel — no second window.
        await openCellTracePanel({ kind: msg.kind, cube, dims, coords, config });
      }
    });
  }
  // ViewColumn: deliberate
  // Also `Beside` on re-reveal: a trace the user has pushed aside should
  // reappear next to the viewer (see the comment above).
  panel.reveal(vscode.ViewColumn.Beside);

  // Post only while this call is still the newest request for the key.
  // Stale (superseded) or disposed → drop; the newest request always wins
  // regardless of HTTP resolve order. `loading` posts run synchronously
  // before any await, so they always pass.
  const post = (m: TracePanelIn) => {
    if (_activeReq.get(key) !== seq) { return; }
    void postTo<TracePanelIn>(panel!.webview, m);
  };
  const coordsLabel = coords.join(' | ');
  post({ type: 'loading', kind });
  try {
    if (kind === 'rule') {
      let rules = '';
      try { rules = await fetchRules(cube, config); } catch { /* leave empty */ }
      const root = await traceRule(cube, dims, coords, config);
      post({ type: 'ruleResult', cube, coords: coordsLabel, root, rules, dims });
    } else if (kind === 'feeders') {
      let rules = '';
      try { rules = await fetchRules(cube, config); } catch { /* leave empty */ }
      const feeders = await traceFeeders(cube, dims, coords, config);
      post({ type: 'feedersResult', cube, coords: coordsLabel, feeders, rules });
    } else {
      const unfed = await checkFeeders(cube, dims, coords, config);
      post({ type: 'checkResult', cube, coords: coordsLabel, unfed });
    }
  } catch (err) {
    post({ type: 'error', message: errMsg(err) });
  }
}
