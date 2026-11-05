/**
 * Editor-level event listeners: paste/clipboard/drag-drop/external-links/focus.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import * as monaco from 'monaco-editor';
import { installCopyCutProxy, installPasteProxy } from '../_shared/clipboardProxy';
import { editor, vscode } from './state';
import { buildSavePayload } from './save';

export {};

let _externalLinkHandlerInstalled = false;

/** Route `window.open('https://…')` calls to the host instead of the sandboxed
 *  webview. Installed once, explicitly, from `initEditorEvents` (not as an import
 *  side effect) so ordering with the rest of the wiring is deterministic. */
function installExternalLinkHandler(): void {
  if (_externalLinkHandlerInstalled) { return; }
  _externalLinkHandlerInstalled = true;
  const origOpen = window.open.bind(window);
  (window as any).open = (url?: string | URL, _target?: string, _features?: string) => {
    const u = typeof url === 'string' ? url : (url instanceof URL ? url.toString() : '');
    if (u && /^https?:\/\//i.test(u)) {
      vscode.postMessage({ type: 'openExternal', url: u });
      return null;
    }
    return origOpen(url as any, _target, _features);
  };
}

export function initEditorEvents(): void {
  installExternalLinkHandler();

  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) { return; }
    const a = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!a) { return; }
    const href = a.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) { return; }
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage({ type: 'openExternal', url: href });
  }, true);

  document.addEventListener('mousedown', (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) { return; }
    if (t.closest('.toolbar button, .tabs button, .ref-toolbar button, .resolver-toolbar button')) {
      e.preventDefault();
    }
  }, true);

  installPasteProxy(monaco, editor, (msg) => vscode.postMessage(msg));

  // Copy/cut via the host — see `_shared/clipboardProxy.ts`.
  installCopyCutProxy(monaco, editor, (msg) => vscode.postMessage(msg));

  // Ctrl+S / Ctrl+Shift+S on `document` (capture): Monaco's addCommand binding
  // only takes effect with editor focus — on the form tabs (Parameters/Datasource/
  // Variables) or with focus in the toolbar/inputs the shortcut did nothing otherwise.
  // stopPropagation prevents a double save via the parallel Monaco binding.
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) { return; }
    if (e.key.toLowerCase() !== 's') { return; }
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage(buildSavePayload(e.shiftKey ? 'saveAs' : 'save'));
  }, true);

  // NOTE: no tree → Monaco drop handler. A drag started in a native VS Code
  // TreeView does not fire an HTML5 drop event inside the webview iframe — the
  // payload never crosses the boundary (microsoft/vscode #111092 out-of-scope,
  // #245816). Use the tree context-menu "insert reference" command instead.

  editor.getDomNode()?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!editor.hasTextFocus()) { return; }
    if (e.key !== '#' || e.ctrlKey || e.metaKey || e.altKey) { return; }
    const sel = editor.getSelection();
    const spansMultipleLines = sel !== null && sel.startLineNumber !== sel.endLineNumber;
    if (!spansMultipleLines) { return; }
    e.preventDefault();
    e.stopPropagation();
    void editor.getAction('editor.action.commentLine')?.run();
  }, true);
}

