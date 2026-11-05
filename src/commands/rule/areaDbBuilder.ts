import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getStorageDimensionOrder, getCubeDimensionNames } from '../../tm1Rest/cubeApi';
import { fetchNames } from '../../providers/fetchNames';
import { fetchElementsPage } from '../../tm1Rest/areaDbBuilderRest';
import { getAreaDbBuilderHtml } from './areaDbBuilderWebview';
import type { HostToBuilder, BuilderToHost } from '../../webviewClient/areaDbBuilder/protocol';
import { errMsg } from '../../utils/errMsg';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

export interface AreaDbBuilderOptions {
  extensionUri: vscode.Uri;
  config: Tm1Config;
  currentCube: string;
  onInsert: (text: string) => void;
}

const host = new WebviewPanelHost<BuilderToHost>('tm1AreaDbBuilder', 'Area/DB Builder');

/**
 * A running number instead of a fixed key.
 *
 * The builder is not a single instance per object, but a wizard that may
 * be open twice side by side — a fixed key would let the second call only
 * bring the first window to the front. The model is the key space of the
 * Dimension Browser's selection panels (`::sel#<n>`, since 2026-08-02):
 * `reveal` never hits it, but `disposePanelsForServer` does. Exactly this
 * approach was missing here — the window survived disconnecting, `config`
 * and all.
 */
let _seq = 0;

/** Close all open Area/DB builders of this server (on disconnect). */
export function disposeAreaDbBuilderForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

// Wizard: holds a `Tm1Config` in the closure and waits for input. On
// disconnect it closes, and the waiting caller gets `undefined` — instead
// of a form that asks against a dead server.
registerServerDisposer('areaDbBuilder', (url) => disposeAreaDbBuilderForServer(url));

export function openAreaDbBuilder(opts: AreaDbBuilderOptions): void {
  const { extensionUri, config, currentCube, onInsert } = opts;
  host.initialize(extensionUri);
  const post = (m: HostToBuilder): void => { void postTo<HostToBuilder>(panel?.webview, m); };

  const panel = host.open({
    key: `${config.serverUrl}::areaDb#${++_seq}`,
    title: vscode.l10n.t('Area/DB Builder'),
    // ViewColumn: deliberate
    // `Beside` on purpose: the wizard sits NEXT TO the rule editor, into
    // which it inserts its text — both visible at the same time. `Beside`
    // is relative to the active group and thus stays in the same window;
    // hence NO switch to `Active` here.
    viewColumn: vscode.ViewColumn.Beside,
    html: (webview, uri) => getAreaDbBuilderHtml(webview, uri),
    onMessage: async (msg) => {
      if (!msg || !msg.type) { return; }
      try {
        switch (msg.type) {
          case 'ready': {
            let cubes: string[] = [];
            try {
              cubes = await fetchNames('Cubes', config);
            } catch (err) {
              // Surface the failure instead of silently degrading to an empty
              // cube list — AREA mode still works (current cube), so post init
              // first, then the error so the webview hint shows what happened.
              post({ type: 'init', currentCube, cubes: [] });
              post({ type: 'error', message: errMsg(err) });
              break;
            }
            post({ type: 'init', currentCube, cubes });
            break;
          }
          case 'fetchDims': {
            let dims: string[] = [];
            try {
              dims = await getStorageDimensionOrder(config, msg.cube);
            } catch {
              try { dims = await getCubeDimensionNames(config, msg.cube); } catch { dims = []; }
            }
            post({ type: 'dims', cube: msg.cube, dims });
            break;
          }
          case 'fetchElements': {
            const { rows, hasMore } = await fetchElementsPage(config, msg.dim, msg.query, msg.skip);
            post({ type: 'elements', dim: msg.dim, query: msg.query, rows, skip: msg.skip, hasMore });
            break;
          }
          case 'confirm': {
            onInsert(msg.text);
            panel?.dispose();
            break;
          }
          case 'cancel': {
            panel?.dispose();
            break;
          }
        }
      } catch (err) {
        // A dedicated catch instead of the host's default channel: the
        // builder reports errors INSIDE the window (a hint line), not as a
        // toast.
        post({ type: 'error', message: errMsg(err) });
      }
    },
  });
}
