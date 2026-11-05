// Copy and cut in a Monaco webview.
//
// The webview may not read or write the clipboard itself, so the client sends
// the text to the host (`requestCopy`) and fetches it from there
// (`requestPaste` → `pasteText`). Monaco's own commands go nowhere in the
// process.
//
// The listener is attached to `document` (capture), NOT to `editor.getDomNode()`:
// Monaco renders suggest, find and hover widgets OUTSIDE the editor node. Within
// the node scope Ctrl+C/X would then not reach the proxy and would fall back to
// Monaco's own cut — which silently does nothing in the webview. Paste has
// always run on `document`; that is why only cut/copy was unreliable. The
// `hasTextFocus()` guard must stay: an input field in the same webview is a DOM
// descendant, and without the guard Ctrl+C there hijacks the editor selection.
//
// Four editors had written this block out line by line.
import type * as monacoType from 'monaco-editor';

/**
 * Attaches the copy/cut proxy to `document`.
 *
 * `post` receives exactly one message type: `{ type: 'requestCopy', text }`.
 * An empty selection means "whole line" — as in VS Code itself.
 */
export function installCopyCutProxy(
  monaco: typeof monacoType,
  editor: monacoType.editor.IStandaloneCodeEditor,
  post: (msg: { type: 'requestCopy'; text: string }) => void,
): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!editor.hasTextFocus()) { return; }
    if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey)) { return; }
    const key = e.key.toLowerCase();
    if (key !== 'c' && key !== 'x') { return; }
    const model = editor.getModel();
    if (!model) { return; }

    const sel = editor.getSelection();
    let text: string;
    let cutRange: monacoType.IRange | null = null;
    if (!sel || sel.isEmpty()) {
      const lineNo = sel ? sel.startLineNumber : (editor.getPosition()?.lineNumber ?? 1);
      text = model.getLineContent(lineNo) + '\n';
      if (key === 'x') {
        cutRange = lineNo < model.getLineCount()
          ? new monaco.Range(lineNo, 1, lineNo + 1, 1)
          : new monaco.Range(lineNo, 1, lineNo, model.getLineContent(lineNo).length + 1);
      }
    } else {
      text = model.getValueInRange(sel);
      if (key === 'x') { cutRange = sel; }
    }

    e.preventDefault();
    e.stopPropagation();
    post({ type: 'requestCopy', text });
    if (cutRange) {
      editor.executeEdits('cut', [{ range: cutRange, text: '' }]);
    }
  }, true);
}

/**
 * Attaches the paste proxy to `document`.
 *
 * `post` receives exactly one message type: `{ type: 'requestPaste' }`. The
 * caller handles the answer (`pasteText`) itself — in every window it arrives
 * through that window's own message receiver.
 *
 * ── Why TWO paths and not one ──────────────────────────────────────────────
 *
 * Until 2026-09-20 there were two strategies in four files: the rule and
 * process editors listened for the `paste` event with a Ctrl+V fallback, the
 * MDX runner and the TI console only for Ctrl+V. Both for the same problem, and
 * whoever touched the 50 ms timer had to keep two files in sync.
 *
 * The richer path was chosen because it can strictly do more: if a real `paste`
 * event arrives WITH text — context menu, middle mouse button under X11, a
 * webview that does pass the clipboard through after all — that text is
 * inserted immediately, without a detour via the host. If it does not arrive,
 * the Ctrl+V path fetches the text from there. The timer separates the two
 * cases: the `paste` event comes, if it comes, immediately after the
 * keystroke.
 */
export function installPasteProxy(
  monaco: typeof monacoType,
  editor: monacoType.editor.IStandaloneCodeEditor,
  post: (msg: { type: 'requestPaste' }) => void,
): void {
  const insert = (text: string): void => {
    if (!text) { return; }
    const sel = editor.getSelection();
    if (!sel) { return; }
    editor.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.focus();
  };

  let eventSeen = false;

  document.addEventListener('paste', (e: ClipboardEvent) => {
    if (!editor.hasTextFocus()) { return; }
    eventSeen = true;
    const text = e.clipboardData?.getData('text') ?? '';
    e.preventDefault();
    e.stopPropagation();
    if (text) { insert(text); } else { post({ type: 'requestPaste' }); }
  }, true);

  // Fallback via Monaco's own key handling: it also fires where the webview
  // does not let the `paste` event through at all.
  editor.onKeyDown((e) => {
    // `metaKey` must be included: on macOS Cmd+V is the paste key, and without it
    // the fallback goes nowhere there (copy above checks both).
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) { return; }
    if (e.keyCode !== monaco.KeyCode.KeyV) { return; }
    eventSeen = false;
    setTimeout(() => {
      if (!eventSeen) { post({ type: 'requestPaste' }); }
    }, 50);
  });
}
