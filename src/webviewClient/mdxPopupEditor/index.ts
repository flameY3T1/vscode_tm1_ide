/**
 * Stand-alone Monaco-MDX editor bundle, lazy-loaded into the cubeViewer MDX
 * popup on first open. Exposes a minimal global API so the cubeViewer IIFE
 * bundle can mount/teardown without importing Monaco itself.
 *
 * Build target: out/webview/mdxPopupEditor.js (~4 MB — Monaco).
 * Caller: cubeViewerMonaco/mdxView.ts injects <script src=... nonce=...>
 * on first popup-open, then uses window.mdxPopupEditor.{init,getValue,setValue,layout}.
 */
import * as monaco from 'monaco-editor';
import { registerMdxLanguage } from '../mdxRunnerMonaco/mdxMonarch';

// Monaco webworker stub — same pattern as the other Monaco bundles (no real workers in webviews).
(self as any).MonacoEnvironment = {
  getWorker: () => ({
    postMessage: () => { /* noop */ },
    terminate: () => { /* noop */ },
    onmessage: null,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
  }),
};

registerMdxLanguage(monaco);

let _editor: monaco.editor.IStandaloneCodeEditor | null = null;
let _model: monaco.editor.ITextModel | null = null;
let _themeObserver: MutationObserver | null = null;

function _pickTheme(): 'mdx-light' | 'mdx-dark' {
  const cl = document.body.classList;
  if (cl.contains('vscode-light') || cl.contains('vscode-high-contrast-light')) { return 'mdx-light'; }
  return 'mdx-dark';
}

(window as any).mdxPopupEditor = {
  init(container: HTMLElement, initialValue: string): void {
    if (_editor) { _editor.setValue(initialValue); _editor.focus(); return; }
    _model = monaco.editor.createModel(initialValue, 'mdx');
    _editor = monaco.editor.create(container, {
      model: _model,
      language: 'mdx',
      theme: _pickTheme(),
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      fontSize: 13,
      minimap: { enabled: false },
      wordWrap: 'on',
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      glyphMargin: false,
      folding: false,
      // Force the classic hidden <textarea> input surface. Monaco 0.55 defaults
      // to the EditContext API, whose input element is <div.native-edit-context>
      // (not a textarea). The dim-browser / cube-viewer host webviews have
      // document-level keydown guards that only exempt INPUT/TEXTAREA/SELECT/
      // contentEditable, so an EditContext surface gets its keystrokes swallowed
      // (visible text, no caret, no typing). A real textarea is exempt everywhere.
      editContext: false,
    });
    _themeObserver = new MutationObserver(() => monaco.editor.setTheme(_pickTheme()));
    _themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    _editor.focus();
  },
  getValue(): string {
    return _editor ? _editor.getValue() : '';
  },
  setValue(v: string): void {
    if (_editor) { _editor.setValue(v); }
  },
  layout(): void {
    if (_editor) { _editor.layout(); }
  },
};
