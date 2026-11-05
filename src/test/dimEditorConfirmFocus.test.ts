import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import {
  FakeDocument, keyEvent, grabDialog, settledOrPending,
  type OpenDialog,
} from './helpers/confirmDialogDom';

/**
 * The two ADAPTERS onto `_shared/confirmDialog.ts`:
 *
 *  - `dimensionEditor/modals.ts#askConfirm`
 *  - `securityUserGroup/index.ts#confirmModal`
 *
 * Until 2026-08-07 both ran their own server-rendered markup (`#confirm-modal`,
 * `#modal-confirm`) — without `role`/`aria-modal`, without `aria-labelledby`, without
 * a focus trap, and with five unchecked `getElementById` accesses. A screen reader
 * announced neither that a modal had opened nor what it asked. Since the migration
 * both build the shared dialog in the client.
 *
 * That is why ONLY the mapping adapter → shared dialog is tested: which
 * text becomes the heading, which the detail line, which labels come from
 * `__l10n`, and whether the destructive path is marked as such. The keyboard and
 * ARIA contract of the dialog itself lives in `confirmDialogKeyboard.test.ts` and is
 * not checked twice here.
 *
 * NOT covered (a DOM double cannot do it): real focus order, `inert` as an
 * effect, `:focus` visibility.
 */

const L10N = {
  ok: 'OK',
  cancel: 'Abbrechen',
  confirm: 'Bestätigen',
};

let doc: FakeDocument;

function press(key: string, shiftKey = false): void {
  doc.dispatch('keydown', keyEvent(key, shiftKey));
}

function setDocument(d: FakeDocument | undefined): void {
  if (d) { (globalThis as { document?: unknown }).document = d; }
  else { delete (globalThis as { document?: unknown }).document; }
}

/** Text behind `aria-labelledby` or `aria-describedby` of the open dialog. */
function labelText(dlg: OpenDialog): string | undefined {
  const id = dlg.box.getAttribute('aria-labelledby');
  return id ? doc.getElementById(id)?.textContent : undefined;
}
function detailText(dlg: OpenDialog): string | undefined {
  const id = dlg.box.getAttribute('aria-describedby');
  return id ? doc.getElementById(id)?.textContent : undefined;
}

interface DimAskConfirmOpts { message?: string; detail?: string; yes?: string; danger?: boolean }
type DimAskConfirm = (opts: DimAskConfirmOpts) => Promise<boolean>;

/** Fresh import of `modals.ts` — `const L = getL10n()` runs on load. */
async function importModalsWithL10n(map: Record<string, string> | undefined): Promise<DimAskConfirm> {
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  if (map) { g.__l10n = map; } else { delete g.__l10n; }
  const mod = await import('../webviewClient/dimensionEditor/modals');
  return mod.askConfirm as DimAskConfirm;
}

// ---------------------------------------------------------------------------
// A) dimensionEditor/modals.ts#askConfirm
// ---------------------------------------------------------------------------

describe('dimensionEditor/modals#askConfirm — adapter onto the shared dialog', () => {
  let askConfirm: DimAskConfirm;

  beforeAll(async () => { askConfirm = await importModalsWithL10n(L10N); });

  beforeEach(() => { doc = new FakeDocument(); setDocument(doc); });
  afterEach(() => setDocument(undefined));

  it('opens the shared dialog instead of server-rendered markup', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: 'Delete element?', danger: true }));
    expect(dlg.box.getAttribute('aria-modal')).toBe('true');
    press('Escape');
    await dlg.answer;
  });

  it('danger: true focuses "Cancel" and reports role=alertdialog', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: 'Delete element?', yes: 'Delete', danger: true }));

    expect(doc.activeElement).toBe(dlg.cancelBtn);
    expect(dlg.okBtn.focusCount).toBe(0);
    expect(dlg.box.getAttribute('role')).toBe('alertdialog');
    // Without any action the dialog stays open — a blind Enter can only cancel.
    expect(await settledOrPending(dlg.answer)).toBe('pending');

    dlg.cancelBtn.fire('click', {});
    expect(await dlg.answer).toBe(false);
  });

  it('without danger OK stays the initial focus (unchanged convenience path)', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: '3 save errors', detail: '• x', yes: 'OK' }));

    expect(doc.activeElement).toBe(dlg.okBtn);
    expect(dlg.cancelBtn.focusCount).toBe(0);
    expect(dlg.box.getAttribute('role')).toBe('dialog');

    dlg.okBtn.fire('click', {});
    expect(await dlg.answer).toBe(true);
  });

  it('OK yields true, Escape false', async () => {
    const yes = grabDialog(doc, askConfirm({ message: 'Delete?', danger: true }));
    yes.okBtn.fire('click', {});
    expect(await yes.answer).toBe(true);

    const no = grabDialog(doc, askConfirm({ message: 'Delete?', danger: true }));
    press('Escape');
    expect(await no.answer).toBe(false);
  });

  it('message becomes the heading, detail the describing line', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: 'Delete?', detail: 'still in use', danger: true }));
    expect(labelText(dlg)).toBe('Delete?');
    expect(detailText(dlg)).toBe('still in use');
    press('Escape');
    await dlg.answer;
  });

  it('without detail there is no describing line', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: 'Delete?', danger: true }));
    expect(labelText(dlg)).toBe('Delete?');
    expect(dlg.box.getAttribute('aria-describedby')).toBeNull();
    press('Escape');
    await dlg.answer;
  });

  it('`yes` beats the locale, "Cancel" always comes from __l10n', async () => {
    const custom = grabDialog(doc, askConfirm({ message: 'Delete?', yes: 'Delete', danger: true }));
    expect(custom.okBtn.textContent).toBe('Delete');
    expect(custom.cancelBtn.textContent).toBe(L10N.cancel);
    press('Escape');
    await custom.answer;

    const plain = grabDialog(doc, askConfirm({ message: 'Proceed?' }));
    expect(plain.okBtn.textContent).toBe(L10N.ok);
    press('Escape');
    await plain.answer;
  });

  it('cleans up dialog and document listeners (no stacking across several openings)', async () => {
    for (let i = 0; i < 3; i++) {
      const dlg = grabDialog(doc, askConfirm({ message: 'Delete?', danger: true }));
      expect(doc.listenerCount('keydown')).toBe(1);
      press('Escape');
      expect(await dlg.answer).toBe(false);
      expect(doc.listenerCount('keydown')).toBe(0);
      expect(doc.body.findByClass('tm1-confirm-backdrop')).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// B) Label fallback without a locale map
// ---------------------------------------------------------------------------

describe('dimensionEditor/modals#askConfirm — labels without __l10n', () => {
  let askConfirm: DimAskConfirm;

  beforeAll(async () => { askConfirm = await importModalsWithL10n(undefined); });

  beforeEach(() => { doc = new FakeDocument(); setDocument(doc); });
  afterEach(() => setDocument(undefined));

  it('falls back to the English literals instead of empty buttons', async () => {
    const dlg = grabDialog(doc, askConfirm({ message: 'Proceed?' }));
    expect(dlg.okBtn.textContent).toBe('OK');
    expect(dlg.cancelBtn.textContent).toBe('Cancel');
    press('Escape');
    await dlg.answer;
  });
});

// ---------------------------------------------------------------------------
// C) securityUserGroup/index.ts#confirmModal
// ---------------------------------------------------------------------------

describe('securityUserGroup#confirmModal — adapter onto the shared dialog', () => {
  let confirmModal: (title: string, message: string) => Promise<boolean>;

  beforeAll(async () => {
    // On import the module wires up `window`/`document` and calls
    // `acquireVsCodeApi()` — the globals must be in place BEFORE the import.
    vi.resetModules();
    setDocument(new FakeDocument());
    const g = globalThis as Record<string, unknown>;
    g.__l10n = L10N;
    g.window = { addEventListener: () => { /* message channel unused in the test */ } };
    g.acquireVsCodeApi = () => ({ postMessage: () => { /* no host in the test */ } });
    ({ confirmModal } = await import('../webviewClient/securityUserGroup/index'));
    setDocument(undefined);
  });

  beforeEach(() => { doc = new FakeDocument(); setDocument(doc); });
  afterEach(() => setDocument(undefined));

  it('title becomes the heading, message the describing line', async () => {
    const dlg = grabDialog(doc, confirmModal('Delete user', 'Really delete „u1"?'));

    expect(labelText(dlg)).toBe('Delete user');
    expect(detailText(dlg)).toBe('Really delete „u1"?');
    expect(dlg.okBtn.textContent).toBe(L10N.confirm);
    expect(dlg.cancelBtn.textContent).toBe(L10N.cancel);

    press('Escape');
    await dlg.answer;
  });

  it('always destructive: focus on "Cancel", role=alertdialog', async () => {
    const dlg = grabDialog(doc, confirmModal('Delete user', 'Really delete „u1"?'));

    expect(doc.activeElement).toBe(dlg.cancelBtn);
    expect(dlg.okBtn.focusCount).toBe(0);
    expect(dlg.box.getAttribute('role')).toBe('alertdialog');
    expect(await settledOrPending(dlg.answer)).toBe('pending');

    dlg.okBtn.fire('click', {});
    expect(await dlg.answer).toBe(true);
  });

  it('Escape closes with false', async () => {
    const dlg = grabDialog(doc, confirmModal('Delete group', 'Really delete „g1"?'));
    press('Escape');

    expect(await dlg.answer).toBe(false);
    expect(doc.body.findByClass('tm1-confirm-backdrop')).toBeNull();
  });

  it('other keys trigger nothing', async () => {
    const dlg = grabDialog(doc, confirmModal('Delete user', 'x'));
    press('a');

    expect(await settledOrPending(dlg.answer)).toBe('pending');
    dlg.cancelBtn.fire('click', {});
    expect(await dlg.answer).toBe(false);
  });

  it('cleans up the document listeners (no stacking, no double resolution)', async () => {
    for (let i = 0; i < 3; i++) {
      const dlg = grabDialog(doc, confirmModal('Delete user', 'x'));
      expect(doc.listenerCount('keydown')).toBe(1);
      expect(doc.listenerCount('focusin')).toBe(1);
      press('Escape');
      expect(await dlg.answer).toBe(false);
      expect(doc.listenerCount('keydown')).toBe(0);
      expect(doc.listenerCount('focusin')).toBe(0);
    }
  });
});
