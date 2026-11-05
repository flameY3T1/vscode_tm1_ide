/**
 * Dimension Browser webview client — Bootstrap.
 *
 * Bundled by esbuild from `src/webviewClient/dimensionBrowser/index.ts` →
 * `out/webview/dimensionBrowser.js` and loaded into the panel by
 * `src/commands/dimension/dimensionBrowserWebview.ts`.
 *
 * index.ts is pure bootstrap: it wires the subset module, the message router,
 * the DOM listeners and the view diagnostics, nothing else. The module map
 * (one line per file) lives in `docs/architecture/dimension-browser.md`,
 * section "Module map" — kept there only, so it cannot drift in two places.
 *
 * WARNING: `src/test/dimBrowserDomWiring.test.ts` checks the wiring by
 * SOURCE-TEXT SCAN for marker strings and resolves the right file per marker.
 * Whoever moves handlers between the `dom*.ts` files has to carry the mapping over there
 * - otherwise the guard silently turns green instead of red. For the same reason
 * module header comments must not quote marker strings verbatim.
 */
import { initSubset } from './subset';
import { _updateSelectionFooter } from './footer';
import { initMsgHandler } from './msg';
import { initDomHandlers } from './dom';
import { initViewDiag } from './viewDiag';
import type { WebviewToHost } from './protocol';
import { tryGetVsCodeApi } from '../_shared/vscodeApi';


export {};

const vscode = tryGetVsCodeApi<WebviewToHost>();

// `subset.ts` posts the subset queries itself; everything else in this
// wiring (redraw, footer, composition base) belonged to the old
// renderer and fell away with it.
initSubset({
  postMessage: (msg) => { if (vscode) vscode.postMessage(msg); },
});

// Message router + DOM listeners.
initMsgHandler({ vscode });
initDomHandlers({ vscode });
// Ctrl+Alt+K - state report for the view (see `viewDiag.ts`).
initViewDiag();


// P1-8b (Stufe 4 Race-Protokolle): signal the host that the message listener
// is registered — triggers a resend of the initial setMode/setSubsetExpression
// payloads if they were posted before this listener existed (webview
// cold-start race). Mirrors cubeViewer / mdxRunner.
if (vscode) { vscode.postMessage({ type: 'webviewReady' }); }
