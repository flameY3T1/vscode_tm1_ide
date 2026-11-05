/**
 * Cube-Viewer webview entry point — Monaco-style migration.
 *
 * Loaded by the shell in `src/commands/cubeViewer/cubeViewerWebview.ts` via
 * `<script nonce="..." src="${asWebviewUri(out/webview/cubeViewerMonaco.js)}">`.
 *
 * Subsequent phases will port the remaining webview JS (context menus +
 * spread prompt) into typed modules in this directory.
 *
 * The shell currently still uses the inline-template path; this bundle is
 * built in parallel so we can swap atomically in P10.
 */

import { vscode } from './vscodeApi';
import { initDomRefs } from './dom';
import { wireGridDblClick, wireUndoShortcut } from './editor';
import { wireDragAndDrop } from './axis';
import { wireMessageHandler, wireButtons } from './messaging';
import { wireViewPicker } from './viewPicker';
import { wireViewSave } from './viewSave';
import { wireContextMenu } from './contextMenu';
import { wireFormatDialog } from './formatDialog';
import { wireSelection } from './selection';
import { wireMdxButton } from './mdxView';
import { wirePaste } from './paste';
import { wireClear } from './clear';

function bootstrap(): void {
  initDomRefs();
  wireMessageHandler();
  wireButtons();
  wireGridDblClick();
  wireUndoShortcut();
  wireDragAndDrop();
  wireViewPicker();
  wireViewSave();
  wireContextMenu();
  wireFormatDialog();
  wireSelection();
  wirePaste();
  wireClear();
  wireMdxButton();
  // Signal extension that all message handlers are wired — triggers initData re-send if it was lost
  vscode.postMessage({ type: 'webviewReady' });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
