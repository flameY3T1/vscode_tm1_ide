// src/webviewClient/_shared/confirmDialog.ts
//
// Self-contained yes/no dialog for webview clients.
//
// `window.confirm()` is disabled inside the VS Code webview sandbox — it returns
// a falsy value without ever showing anything, so `if (confirm(...)) { … }` is a
// dead branch. `dimensionEditor/modals.ts#askConfirm` solves the same problem but
// binds to fixed element ids (`#confirm-modal`, `#confirm-modal-ok`, …) that only
// the dimension editor's server-rendered body provides, and it dereferences them
// without a null check. This module builds (and tears down) its own DOM instead,
// so any webview can call it without growing markup or CSS on the extension side.
//
// The injected `<style>` is covered by the shell CSP (`style-src … 'unsafe-inline'`,
// see `webviews/webviewShell.ts`). Labels are passed in by the caller — resolved
// extension-side via `vscode.l10n.t` and injected through `window.__l10n`.

export {};

export interface ConfirmDialogOpts {
  /** Headline question, e.g. "Clear entire MDX history?". */
  message: string;
  /** Optional second line with the consequence. */
  detail?: string;
  /** Label of the confirming button. Default `OK`. */
  confirmLabel?: string;
  /** Label of the dismissing button. Default `Cancel`. */
  cancelLabel?: string;
  /** Paint the confirming button in the error colour (destructive action). */
  danger?: boolean;
}

const STYLE_ID = 'tm1-confirm-dialog-style';

const CSS = `
.tm1-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.tm1-confirm-box {
  min-width: 280px;
  max-width: 460px;
  padding: 16px 18px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  border-radius: 4px;
  background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
  color: var(--vscode-editorWidget-foreground, var(--vscode-foreground));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
.tm1-confirm-message { font-weight: 600; margin-bottom: 6px; }
.tm1-confirm-detail {
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.tm1-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.tm1-confirm-actions button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 4px 14px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.tm1-confirm-actions button:hover { background: var(--vscode-button-hoverBackground); }
/* :focus, not only :focus-visible — the initial focus is set programmatically and
   decides what Enter does, so it has to be visible even when Chromium classifies the
   preceding interaction as a pointer gesture and withholds :focus-visible. */
.tm1-confirm-actions button:focus,
.tm1-confirm-actions button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.tm1-confirm-actions button.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.tm1-confirm-actions button.secondary:hover {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
}
.tm1-confirm-actions button.danger {
  background: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
  color: var(--vscode-button-foreground);
}
`;

/** Shared with other modal overlays (processEditorMonaco/paramPrompt.ts) — same look, one sheet. */
export function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) { return; }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** One element we forced inert while a dialog is open, plus its state from before. */
interface InertRecord {
  el: Element;
  hadInert: boolean;
  ariaHidden: string | null;
}

/** Per-dialog counter — `aria-labelledby` needs ids that stay unique across nested opens. */
let dialogSeq = 0;

/**
 * Show a modal yes/no dialog and resolve with the user's answer.
 *
 * Resolves `false` on Cancel, Escape and backdrop click, `true` on the confirm
 * button. Never rejects.
 *
 * Enter follows the FOCUSED button and nothing else — it used to resolve `true`
 * unconditionally, so a keyboard user who deliberately tabbed onto Cancel and
 * pressed Enter confirmed the destructive action instead of aborting it. Focus is
 * trapped inside the dialog (Tab cycles), the rest of the page is made inert while
 * the dialog is open, and the previously focused element gets focus back on close.
 * The initial focus lands on Cancel for `danger` dialogs, on the confirm button
 * otherwise, so the safe answer is the one Enter reaches first.
 */
export function askConfirm(opts: ConfirmDialogOpts): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    ensureStyle();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const seq = ++dialogSeq;

    const backdrop = document.createElement('div');
    backdrop.className = 'tm1-confirm-backdrop';

    const box = document.createElement('div');
    box.className = 'tm1-confirm-box';
    // `alertdialog` is the destructive variant; a plain question is a `dialog`.
    box.setAttribute('role', opts.danger ? 'alertdialog' : 'dialog');
    box.setAttribute('aria-modal', 'true');

    const msg = document.createElement('div');
    msg.className = 'tm1-confirm-message';
    msg.id = `tm1-confirm-message-${seq}`;
    msg.textContent = opts.message;
    box.setAttribute('aria-labelledby', msg.id);
    box.appendChild(msg);

    if (opts.detail) {
      const detail = document.createElement('div');
      detail.className = 'tm1-confirm-detail';
      detail.id = `tm1-confirm-detail-${seq}`;
      detail.textContent = opts.detail;
      box.setAttribute('aria-describedby', detail.id);
      box.appendChild(detail);
    }

    const actions = document.createElement('div');
    actions.className = 'tm1-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary';
    cancelBtn.type = 'button';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    if (opts.danger) { okBtn.classList.add('danger'); }
    okBtn.textContent = opts.confirmLabel || 'OK';

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);
    backdrop.appendChild(box);

    // Tab order inside the trap, and the button Enter must reach first: Cancel for
    // anything destructive, so an unaimed Enter can only ever abort.
    const focusables: HTMLElement[] = [cancelBtn, okBtn];
    const initialFocus: HTMLElement = opts.danger ? cancelBtn : okBtn;

    // Background inert: keeps Tab, screen-reader virtual cursor and pointer out of
    // the page behind the modal. Attribute form (not the `inert` IDL property) so
    // this stays independent of the DOM lib version the webview compiles against.
    const inerted: InertRecord[] = [];
    function inertBackground(): void {
      for (const child of Array.from(document.body.children)) {
        if (child === backdrop) { continue; }
        inerted.push({
          el: child,
          hadInert: child.hasAttribute('inert'),
          ariaHidden: child.getAttribute('aria-hidden'),
        });
        child.setAttribute('inert', '');
        child.setAttribute('aria-hidden', 'true');
      }
    }
    function restoreBackground(): void {
      for (const rec of inerted) {
        if (!rec.hadInert) { rec.el.removeAttribute('inert'); }
        if (rec.ariaHidden === null) { rec.el.removeAttribute('aria-hidden'); }
        else { rec.el.setAttribute('aria-hidden', rec.ariaHidden); }
      }
      inerted.length = 0;
    }

    /** Move focus one step through `focusables`, wrapping at both ends. */
    function focusStep(backwards: boolean): void {
      const cur = focusables.indexOf(document.activeElement as HTMLElement);
      // Focus sits outside the dialog: re-enter at the safe default instead of guessing.
      if (cur < 0) { initialFocus.focus(); return; }
      const next = (cur + (backwards ? -1 : 1) + focusables.length) % focusables.length;
      focusables[next].focus();
    }

    let settled = false;
    function close(result: boolean): void {
      if (settled) { return; }
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocusIn, true);
      restoreBackground();
      backdrop.remove();
      previouslyFocused?.focus?.();
      resolve(result);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); focusStep(e.shiftKey); return; }
      if (e.key !== 'Enter') { return; }
      // The whole point: Enter activates the button that HAS focus. We resolve here
      // rather than let the button's native Enter->click run, because this listener
      // sits in the capture phase (Monaco swallows keys on the way down) — so the
      // native activation may never happen. `preventDefault` keeps the two from
      // both firing where it would.
      e.preventDefault();
      e.stopPropagation();
      const active = document.activeElement;
      if (active === okBtn) { close(true); }
      else if (active === cancelBtn) { close(false); }
      // Focus escaped the dialog (stray programmatic focus, blurred iframe): pull it
      // back and answer nothing. Never resolve a destructive dialog on a blind Enter.
      else { initialFocus.focus(); }
    }
    /** Belt to the Tab trap's braces: focus that lands outside gets pulled back in. */
    function onFocusIn(e: FocusEvent): void {
      if (settled) { return; }
      const target = e.target as Node | null;
      if (target && backdrop.contains(target)) { return; }
      initialFocus.focus();
    }

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(false); } });
    // Capture phase: Monaco installs its own document-level keydown handlers.
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocusIn, true);

    inertBackground();
    document.body.appendChild(backdrop);
    initialFocus.focus();
  });
}
