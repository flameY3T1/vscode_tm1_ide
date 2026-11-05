// src/webviewClient/_shared/mdxPopupApply.ts
//
// Write a new MDX text into the shared MDX popup — as ONE undoable step.
//
// The popup (`mdxPopupEditor`) is attached to two webviews: Cube Viewer and
// Dimension Browser. The function used to exist only in the Cube Viewer
// (`cubeViewerMonaco/mdxView.ts`); the format button of the Dimension Browser
// needs exactly the same movement, so it lives here and not twice.
//
// Deliberately NOT `mdxPopupEditor.setValue`: that throws away Monaco's undo
// stack, and a programmatic rewrite (format, alias choice) could afterwards no
// longer be undone with Ctrl+Z — not even what the user had typed themselves
// beforehand. Hence the route via the model:
// `pushUndoStop → executeEdits → pushUndoStop`, the same form as
// `mdxRunnerMonaco#replaceAll`.
//
// The editor is reached via the shared `window.monaco` (the popup bundle
// resolves `monaco-editor` to it, see
// `esbuild.config.mjs#monacoShimPlugin`), because `window.mdxPopupEditor` only
// offers `setValue`.

/** The parts of a Monaco model that are needed here. */
interface MonacoModelLike {
  getValue(): string;
  getFullModelRange(): unknown;
}

interface MonacoEditorLike {
  getModel(): MonacoModelLike | null;
  getContainerDomNode?: () => HTMLElement | null;
  pushUndoStop(): void;
  executeEdits(
    source: string,
    edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>,
  ): void;
}

function findPopupEditor(mount: HTMLElement): MonacoEditorLike | null {
  const w = window as unknown as {
    monaco?: { editor?: { getEditors?: () => MonacoEditorLike[] } };
  };
  const editors = w.monaco?.editor?.getEditors?.() ?? [];
  for (const ed of editors) {
    const node = ed.getContainerDomNode?.();
    if (node && mount.contains(node)) { return ed; }
  }
  return null;
}

/**
 * Write text into the popup. `mounted` says whether Monaco is attached at all —
 * if it is not, the plain text area is the way (and the value that the modal
 * reads back afterwards).
 *
 * Returns `true` if the model was actually changed. Identical text is skipped
 * so that no empty step lands on the undo stack.
 *
 * `source` is the name under which the step shows up in the editor.
 */
export function applyMdxToPopup(text: string, mounted: boolean, source: string): boolean {
  const textarea = document.getElementById('mdx-text') as HTMLTextAreaElement | null;
  if (textarea && textarea.value !== text) { textarea.value = text; }
  const mount = document.getElementById('mdx-editor');
  if (!mounted || !mount) { return false; }
  const ed = findPopupEditor(mount);
  const model = ed?.getModel();
  if (!ed || !model) { return false; }
  if (model.getValue() === text) { return false; }
  ed.pushUndoStop();
  ed.executeEdits(source, [{
    range: model.getFullModelRange(),
    text,
    forceMoveMarkers: true,
  }]);
  ed.pushUndoStop();
  return true;
}
