/**
 * MDX viewer modal: builds an approximate MDX representation of the current
 * cube viewer state (axes, suppress flags, title context, dim filters) and
 * displays it in a readonly modal. Best-effort — NativeView refreshes don't
 * actually run MDX on the server, so this is a human-readable transcription
 * of "what the viewer is asking for", not a string the server actually ran.
 */

import { state } from './state';
import { escCloses } from '../_shared/escCloses';
import { applyMdxToPopup } from '../_shared/mdxPopupApply';
import { hasMdxPopupBundle, loadedMdxPopupEditor, loadMdxPopupEditor } from '../_shared/mdxPopupLoader';
import { getRefs, setToggleOn, showToast } from './dom';
import { detectNonEmptyAxes } from '../../mdx/nonEmptyAxisPure';
import { formatMdx } from '../../mdx/formatMdxPure';
import { vscode } from './vscodeApi';
import { getL10n, fmt } from '../_shared/l10n';
import { openViewSaveForMdx } from './viewSave';
import { nextReqId } from './reqGuard';
import { buildCurrentMdx, effectiveInlineMdx, setInlineMdx } from './mdxBuild';
import { writeClipboard } from '../_shared/clipboardWrite';

const L = getL10n();

// `buildCurrentMdx` and its helpers have lived in `mdxBuild.ts` since 2026-08-04:
// the save dialog needs the builder as well, and this module imports from it
// (`openViewSaveForMdx`) - a direct back-import would be a cycle.
let _editorMounted = false;

/**
 * Push a new MDX text into the popup surface as ONE undoable step.
 *
 * The move itself lives in `_shared/mdxPopupApply.ts` — the dimension browser's
 * MDX popup is the same surface and needs the same edit, so it is one function
 * for both, not two. Why not `setValue`: see there.
 */
export function applyMdxToPopupEditor(text: string): boolean {
  return applyMdxToPopup(text, _editorMounted, 'aliasMdxSync');
}

function _getReadValue(text: HTMLTextAreaElement): string {
  const editor = loadedMdxPopupEditor();
  if (_editorMounted && editor) {
    return editor.getValue();
  }
  return text.value;
}

/**
 * Open the MDX modal programmatically with the given initial value.
 * Falls back to `effectiveInlineMdx() ?? buildCurrentMdx()` when no value given —
 * the helper only rebuilds the MDX after a local narrowing.
 * Safe to call before `wireMdxButton` returns — element lookups are re-done each time.
 */
export function openMdxModal(initial?: string): void {
  const overlay = document.getElementById('mdx-modal') as HTMLElement | null;
  const text = document.getElementById('mdx-text') as HTMLTextAreaElement | null;
  const editorMount = document.getElementById('mdx-editor') as HTMLElement | null;
  if (!overlay || !text) { return; }
  try {
    const value = initial ?? effectiveInlineMdx() ?? buildCurrentMdx();
    text.value = value;
    overlay.classList.add('visible');
    if (editorMount && hasMdxPopupBundle()) {
      void loadMdxPopupEditor().then((api) => {
        if (!api) {
          text.hidden = false;
          if (editorMount) { editorMount.style.display = 'none'; }
          setTimeout(() => { text.focus(); text.select(); }, 0);
          return;
        }
        api.init(editorMount, value);
        _editorMounted = true;
        setTimeout(() => api.layout(), 0);
      });
    } else {
      text.hidden = false;
      if (editorMount) { editorMount.style.display = 'none'; }
      setTimeout(() => { text.focus(); text.select(); }, 0);
    }
  } catch (err) {
    showToast(fmt(L, 'mdxBuildFailed', (err as Error)?.message ?? String(err)), 'error');
  }
}

export function wireMdxButton(): void {
  const btn = document.getElementById('btn-mdx') as HTMLButtonElement | null;
  const overlay = document.getElementById('mdx-modal') as HTMLElement | null;
  const text = document.getElementById('mdx-text') as HTMLTextAreaElement | null;
  const closeBtn = document.getElementById('mdx-close-btn') as HTMLButtonElement | null;
  const copyBtn = document.getElementById('mdx-copy-btn') as HTMLButtonElement | null;
  const openRunnerBtn = document.getElementById('mdx-open-runner-btn') as HTMLButtonElement | null;
  const runBtn = document.getElementById('mdx-run-btn') as HTMLButtonElement | null;
  const formatBtn = document.getElementById('mdx-format-btn') as HTMLButtonElement | null;
  if (!btn || !overlay || !text || !closeBtn || !copyBtn) return;

  if (openRunnerBtn) {
    openRunnerBtn.addEventListener('click', () => {
      const mdx = _getReadValue(text);
      if (!mdx) return;
      vscode.postMessage({ type: 'openMdxRunner', mdx });
      overlay.classList.remove('visible');
    });
  }
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      const mdx = _getReadValue(text).trim();
      if (!mdx) { showToast(L.mdxEmpty, 'error'); return; }
      setInlineMdx(mdx);
      // Sync the suppress (0 rows / 0 columns) buttons to the pasted MDX's
      // per-axis NON EMPTY so they reflect what is actually executed.
      const ne = detectNonEmptyAxes(mdx);
      const refs = getRefs();
      setToggleOn(refs.chkSuppRows, ne.rows);
      setToggleOn(refs.chkSuppCols, ne.cols);
      // From here the grid shows a query: refreshes and pivots rewrite it. The
      // host used to keep that fact alone and replayed this MDX over every
      // later layout change (review 2026-11-02, C1).
      state.isMdxView = true;
      vscode.postMessage({ type: 'runInlineMdx', mdx, reqId: nextReqId(state) });
      overlay.classList.remove('visible');
    });
  }

  if (formatBtn) {
    formatBtn.addEventListener('click', () => {
      const mdx = _getReadValue(text);
      if (!mdx.trim()) { return; }
      // Same undoable single edit as the alias sync — and it keeps the plain
      // textarea fallback working when the Monaco bundle never loaded.
      applyMdxToPopupEditor(formatMdx(mdx));
    });
  }

  const saveBtn = document.getElementById('mdx-save-btn') as HTMLButtonElement | null;

  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const mdx = _getReadValue(text).trim();
      if (!mdx) { showToast(L.mdxEmpty, 'error'); return; }
      overlay.classList.remove('visible');
      openViewSaveForMdx(mdx);
    });
  }

  btn.addEventListener('click', () => {
    // Prefer the last user-edited MDX over the auto-rebuilt one so refresh/edit cycles round-trip.
    openMdxModal(effectiveInlineMdx() ?? undefined);
  });
  closeBtn.addEventListener('click', () => overlay.classList.remove('visible'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('visible'); });
  copyBtn.addEventListener('click', () => {
    void writeClipboard(_getReadValue(text)).then(ok => { if (ok) showToast(L.mdxCopied, 'success'); });
  });
  // Via `escCloses`, not by hand: the shared helper listens in the
  // CAPTURE phase and calls `stopImmediatePropagation`. Without both, the
  // grid's Escape listener underneath would fire too - it clears the selection.
  escCloses(overlay, () => overlay.classList.remove('visible'));
}
