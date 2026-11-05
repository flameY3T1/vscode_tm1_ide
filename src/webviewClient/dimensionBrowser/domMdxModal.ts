/**
 * MDX popup of the Dimension Browser webview.
 *
 * Was block 2 of the former monolithic `dom.ts` (S2-12, Review 2026-08-02) - a pure
 * move, no behavior change. The shared `mdxPopupEditor` bundle is loaded
 * lazily on the first open via `_shared/mdxPopupLoader.ts`.
 *
 * Called from `dom.ts#initDomHandlers` at the spot where the block
 * previously stood inline - the registration order is thereby preserved.
 */

import { state } from './state';
import { mdxForPopup, runEditedMdx } from './mdxSource';
import { getL10n } from '../_shared/l10n';
import { escCloses } from '../_shared/escCloses';
import { applyMdxToPopup } from '../_shared/mdxPopupApply';
import { hasMdxPopupBundle, loadedMdxPopupEditor, loadMdxPopupEditor, type MdxPopupEditorApi } from '../_shared/mdxPopupLoader';
import { formatMdx } from '../../mdx/formatMdxPure';
import type { WebviewToHost } from './protocol';
import { writeClipboard } from '../_shared/clipboardWrite';

const L = getL10n();

type VsApi = { postMessage: (msg: WebviewToHost) => void } | null;

export function initMdxModal(vscode: VsApi): void {
  const _mdxBtn = document.getElementById('mdx-btn') as HTMLButtonElement | null;
  const _mdxOverlay = document.getElementById('mdx-modal') as HTMLElement | null;
  const _mdxText = document.getElementById('mdx-text') as HTMLTextAreaElement | null;
  const _mdxClose = document.getElementById('mdx-close-btn') as HTMLButtonElement | null;
  const _mdxCopy = document.getElementById('mdx-copy-btn') as HTMLButtonElement | null;
  const _mdxEditorMount = document.getElementById('mdx-editor') as HTMLElement | null;
  const _mdxRunBtn = document.getElementById('mdx-run-btn') as HTMLButtonElement | null;

  let _mdxEditorMounted = false;
  function _readMdxValue(): string {
    const editor = loadedMdxPopupEditor();
    if (_mdxEditorMounted && editor) { return editor.getValue(); }
    return _mdxText ? _mdxText.value : '';
  }

  if (_mdxBtn && _mdxOverlay && _mdxText && _mdxClose && _mdxCopy) {
    _mdxBtn.addEventListener('click', function () {
      try {
        // Always show modal first — Monaco lazy-load may fail, but textarea
        // fallback is still useful. Open before any work that could throw.
        _mdxOverlay!.classList.add('visible');
        // The popup shows exactly what the bar shows. Which bar that is is
        // decided by `mdxForPopup`: in the new path the expression of the stack
        // (`viewPath#currentMdx`), in the old one the EFFECTIVE MDX (drill > loaded
        // subset expression > explicit list). No one-time prefill any more -
        // a prefill was what let bar and popup drift apart.
        let initial = '';
        try { initial = mdxForPopup(); } catch (e) {
          console.error('[dimBrowser] MDX for the popup could not be built:', e);
          initial = L.mdxBuildFailed;
        }
        _mdxText!.value = initial;
        if (_mdxEditorMount && hasMdxPopupBundle()) {
          loadMdxPopupEditor().then(function (api: MdxPopupEditorApi | null) {
            if (!api) {
              console.warn('[dimBrowser] Monaco MDX popup bundle failed to load — falling back to textarea');
              _mdxText!.hidden = false;
              if (_mdxEditorMount) _mdxEditorMount.style.display = 'none';
              setTimeout(function () { _mdxText!.focus(); _mdxText!.select(); }, 0);
              return;
            }
            api.init(_mdxEditorMount!, initial);
            _mdxEditorMounted = true;
            setTimeout(function () { api.layout(); }, 0);
          }).catch(function (e: unknown) {
            console.error('[dimBrowser] Monaco MDX popup load threw:', e);
            _mdxText!.hidden = false;
            if (_mdxEditorMount) _mdxEditorMount.style.display = 'none';
          });
        } else {
          _mdxText!.hidden = false;
          if (_mdxEditorMount) _mdxEditorMount.style.display = 'none';
          setTimeout(function () { _mdxText!.focus(); _mdxText!.select(); }, 0);
        }
      } catch (e) {
        console.error('[dimBrowser] MDX button click handler threw:', e);
      }
    });
    // Marker bar → open the MDX popup. Both read `effectiveMdx()`, so the popup
    // can only ever show what the bar already shows. The SERVER stand stays
    // reachable through the bar's tooltip (see `_updateSubsetMdxBar`).
    const _mdxBar = document.getElementById('subset-mdx-bar');
    if (_mdxBar) {
      _mdxBar.addEventListener('click', function () { _mdxBtn!.click(); });
    }
    _mdxClose.addEventListener('click', function () { _mdxOverlay!.classList.remove('visible'); });
    escCloses(_mdxOverlay, function () { _mdxOverlay!.classList.remove('visible'); });
    _mdxOverlay.addEventListener('click', function (e: MouseEvent) {
      if (e.target === _mdxOverlay) { _mdxOverlay!.classList.remove('visible'); }
    });
    _mdxCopy.addEventListener('click', function () {
      void writeClipboard(_readMdxValue());
    });
    // The same button as in the Cube Viewer popup: line breaks and indentation via
    // `formatMdx`, as ONE undoable step (no `setValue`).
    const _mdxFormat = document.getElementById('mdx-format-btn') as HTMLButtonElement | null;
    if (_mdxFormat) {
      _mdxFormat.addEventListener('click', function () {
        const v = _readMdxValue();
        if (!v.trim()) { return; }
        applyMdxToPopup(formatMdx(v), _mdxEditorMounted, 'mdxFormat');
      });
    }
    const _mdxRunner = document.getElementById('mdx-open-runner-btn') as HTMLButtonElement | null;
    if (_mdxRunner && vscode) {
      _mdxRunner.addEventListener('click', function () {
        const v = _readMdxValue();
        if (!v) { return; }
        vscode!.postMessage({
          type: 'openMdxRunner',
          mdx: v,
          dim: state._currentDim || '',
          hier: state._currentHier || state._currentDim || '',
        });
        _mdxOverlay!.classList.remove('visible');
      });
    }
    if (_mdxRunBtn && vscode) {
      _mdxRunBtn.addEventListener('click', function () {
        const v = _readMdxValue().trim();
        if (!v) { return; }
        // The expression becomes the BASE of the view (`viewPath#setMdxBase`) -
        // it replaces the answer on which layers are then laid.
        runEditedMdx(v);
        _mdxOverlay!.classList.remove('visible');
      });
    }
  }
}
