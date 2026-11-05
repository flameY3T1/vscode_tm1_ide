import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { askConfirm } from '../webviewClient/_shared/confirmDialog';
import {
  FakeDocument, FakeElement, keyEvent, grabDialog, settledOrPending,
  type FakeKeyEvent, type OpenDialog,
} from './helpers/confirmDialogDom';

/**
 * Keyboard contract of the shared confirm dialog (`_shared/confirmDialog.ts`).
 *
 * Reason for the regression test (review 2026-08-05, HIGH): the document-wide capture handler
 * treated EVERY `Enter` as `close(true)`. Whoever deliberately tabbed to "Cancel"
 * and pressed Enter thereby confirmed the destructive action — the handler
 * ran before the button click. The test pins down that Enter now follows the
 * FOCUSED button and nobody else.
 *
 * No jsdom in the repo (see `webviewClient/dimensionBrowserDragDrop.test.ts`, which
 * builds a `classList` fake for the same reason). Since the dialog unification
 * the DOM double lives in `helpers/confirmDialogDom.ts`, because
 * `dimEditorConfirmFocus.test.ts` needs the same surface. What a double does NOT
 * reproduce is deliberately not in the test: the real focus order of the browser,
 * `inert` as an effect (only as an attribute), `:focus` styling and Monaco's
 * competing key handlers.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let doc: FakeDocument;
let trigger: FakeElement;

function open(opts: Parameters<typeof askConfirm>[0]): OpenDialog {
  return grabDialog(doc, askConfirm(opts));
}

function press(key: string, shiftKey = false): FakeKeyEvent {
  const e = keyEvent(key, shiftKey);
  doc.dispatch('keydown', e);
  return e;
}

beforeEach(() => {
  doc = new FakeDocument();
  trigger = doc.createElement('button');
  doc.body.appendChild(trigger);
  trigger.focus();
  trigger.focusCount = 0;
  (globalThis as { document?: unknown }).document = doc;
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

const DESTRUCTIVE = {
  message: 'Clear entire MDX history?',
  detail: 'This cannot be undone.',
  confirmLabel: 'Clear all',
  cancelLabel: 'Cancel',
  danger: true,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('confirmDialog — Enter follows the focused button', () => {
  it('Tab to Cancel + Enter yields false (regression: yielded true)', async () => {
    // Non-destructive, so that the initial focus sits on OK and Tab first
    // MUST move it away — exactly the gesture from the finding.
    const dlg = open({ message: 'Proceed?' });
    expect(doc.activeElement).toBe(dlg.okBtn);

    press('Tab');
    expect(doc.activeElement).toBe(dlg.cancelBtn);

    press('Enter');
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('Enter with focus on the confirm button yields true', async () => {
    const dlg = open(DESTRUCTIVE);
    dlg.okBtn.focus();

    press('Enter');
    await expect(dlg.answer).resolves.toBe(true);
  });

  it('Enter right after opening a destructive dialog cancels', async () => {
    const dlg = open(DESTRUCTIVE);
    expect(doc.activeElement).toBe(dlg.cancelBtn);

    press('Enter');
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('Escape yields false', async () => {
    const dlg = open(DESTRUCTIVE);
    dlg.okBtn.focus();

    const e = press('Escape');
    expect(e.defaultPrevented).toBe(true);
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('Enter with focus OUTSIDE the dialog triggers nothing and brings the focus back', async () => {
    const dlg = open(DESTRUCTIVE);
    doc.activeElement = trigger; // e.g. stray programmatic focus

    press('Enter');

    expect(await settledOrPending(dlg.answer)).toBe('pending');
    expect(doc.activeElement).toBe(dlg.cancelBtn);

    press('Escape');
    await dlg.answer;
  });

  it('click on Confirm stays true, click on Cancel false', async () => {
    const a = open(DESTRUCTIVE);
    a.okBtn.fire('click', {});
    await expect(a.answer).resolves.toBe(true);

    const b = open(DESTRUCTIVE);
    b.cancelBtn.fire('click', {});
    await expect(b.answer).resolves.toBe(false);
  });
});

describe('confirmDialog — focus trap', () => {
  it('Tab past the last element jumps back into the dialog', async () => {
    const dlg = open(DESTRUCTIVE);
    expect(doc.activeElement).toBe(dlg.cancelBtn);

    press('Tab');
    expect(doc.activeElement).toBe(dlg.okBtn); // last element

    const e = press('Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(dlg.cancelBtn); // back to the start
    expect(dlg.backdrop.contains(doc.activeElement)).toBe(true);

    press('Escape');
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('Shift+Tab before the first element jumps to the end', async () => {
    const dlg = open(DESTRUCTIVE);
    expect(doc.activeElement).toBe(dlg.cancelBtn); // first element

    press('Tab', true);
    expect(doc.activeElement).toBe(dlg.okBtn);

    press('Escape');
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('focus that wanders outside is brought back (focusin guard)', async () => {
    const dlg = open(DESTRUCTIVE);
    dlg.okBtn.focus();

    doc.dispatch('focusin', { target: trigger });
    expect(doc.activeElement).toBe(dlg.cancelBtn);

    dlg.okBtn.focus();
    doc.dispatch('focusin', { target: dlg.okBtn });
    expect(doc.activeElement).toBe(dlg.okBtn); // focus inside the dialog stays untouched

    press('Escape');
    await expect(dlg.answer).resolves.toBe(false);
  });

  it('returns the focus to the previously focused element and removes the listeners', async () => {
    const dlg = open(DESTRUCTIVE);
    expect(doc.listenerCount('keydown')).toBe(1);
    expect(doc.listenerCount('focusin')).toBe(1);

    press('Escape');
    await dlg.answer;

    expect(doc.activeElement).toBe(trigger);
    expect(trigger.focusCount).toBe(1);
    expect(doc.listenerCount('keydown')).toBe(0);
    expect(doc.listenerCount('focusin')).toBe(0);
    expect(doc.body.findByClass('tm1-confirm-backdrop')).toBeNull();
  });
});

describe('confirmDialog — ARIA and inert background', () => {
  it('references message and detail via aria-labelledby/-describedby', async () => {
    const dlg = open(DESTRUCTIVE);

    const labelledBy = dlg.box.getAttribute('aria-labelledby');
    const describedBy = dlg.box.getAttribute('aria-describedby');
    expect(labelledBy).toBeTruthy();
    expect(describedBy).toBeTruthy();

    expect(doc.getElementById(labelledBy as string)?.textContent).toBe(DESTRUCTIVE.message);
    expect(doc.getElementById(describedBy as string)?.textContent).toBe(DESTRUCTIVE.detail);

    press('Escape');
    await dlg.answer;
  });

  it('leaves out aria-describedby when there is no detail', async () => {
    const dlg = open({ message: 'Proceed?' });
    expect(dlg.box.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dlg.box.getAttribute('aria-describedby')).toBeNull();

    press('Escape');
    await dlg.answer;
  });

  it('assigns different label ids with two open dialogs', async () => {
    const a = open(DESTRUCTIVE);
    const b = open({ message: 'Second question?' });
    expect(a.box.getAttribute('aria-labelledby')).not.toBe(b.box.getAttribute('aria-labelledby'));

    b.cancelBtn.fire('click', {});
    a.cancelBtn.fire('click', {});
    await expect(Promise.all([a.answer, b.answer])).resolves.toEqual([false, false]);
  });

  it('uses role=alertdialog only for destructive dialogs, aria-modal always', async () => {
    const danger = open(DESTRUCTIVE);
    expect(danger.box.getAttribute('role')).toBe('alertdialog');
    expect(danger.box.getAttribute('aria-modal')).toBe('true');
    danger.cancelBtn.fire('click', {});
    await danger.answer;

    const plain = open({ message: 'Proceed?' });
    expect(plain.box.getAttribute('role')).toBe('dialog');
    expect(plain.box.getAttribute('aria-modal')).toBe('true');
    plain.cancelBtn.fire('click', {});
    await plain.answer;
  });

  it('sets the background inert and restores the previous state', async () => {
    const pinned = doc.createElement('div');
    pinned.setAttribute('inert', '');
    pinned.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(pinned);

    const dlg = open(DESTRUCTIVE);
    expect(trigger.hasAttribute('inert')).toBe(true);
    expect(trigger.getAttribute('aria-hidden')).toBe('true');
    expect(dlg.backdrop.hasAttribute('inert')).toBe(false);

    press('Escape');
    await dlg.answer;

    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(trigger.getAttribute('aria-hidden')).toBeNull();
    // What was already inert/hidden before stays so.
    expect(pinned.hasAttribute('inert')).toBe(true);
    expect(pinned.getAttribute('aria-hidden')).toBe('true');
  });
});
