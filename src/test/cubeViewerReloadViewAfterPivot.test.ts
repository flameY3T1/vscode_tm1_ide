/**
 * "Reload view" after a pivot (axis swap, chip into another zone).
 *
 * Every pivot releases the binding to the saved view
 * (`state.existingViewName = null`), because the layout is no longer the saved
 * one. The dropdown keeps the name in doing so — and the button stays armed, because
 * its enablement hangs on the dropdown value (`syncReloadViewEnabled`). Both
 * together are exactly the case in which the button is needed: back to the
 * saved layout. It therefore must not fail on the deleted state field,
 * but must read the view from the dropdown.
 *
 * No jsdom in the project — `select` and `button` are hand-built dummies,
 * just complete enough for `wireViewPicker()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { postMessageSpy, showLoadingSpy } = vi.hoisted(() => {
  (globalThis as unknown as { window?: unknown }).window ??= {};
  return { postMessageSpy: vi.fn(), showLoadingSpy: vi.fn() };
});

vi.mock('../webviewClient/cubeViewerMonaco/vscodeApi', () => ({
  vscode: { postMessage: postMessageSpy },
}));

type Handler = () => void;

class FakeEl {
  handlers: Record<string, Handler[]> = {};
  disabled = false;
  value = '__none__';
  options: { value: string }[] = [];
  selectedIndex = -1;
  innerHTML = '';
  addEventListener(type: string, fn: Handler): void {
    (this.handlers[type] ??= []).push(fn);
  }
  fire(type: string): void { (this.handlers[type] ?? []).forEach((h) => h()); }
  appendChild(): void {}
  nextSibling = null;
  parentNode = { insertBefore(): void {} };
}

const viewSelect = new FakeEl();
const btnReloadView = new FakeEl();

vi.mock('../webviewClient/_shared/filterCombo', () => ({ attachTitleCombo: vi.fn(() => ({})) }));

vi.mock('../webviewClient/cubeViewerMonaco/dom', () => ({
  getRefs: vi.fn(() => ({ viewSelect, btnReloadView })),
  showLoading: showLoadingSpy,
}));

import { state } from '../webviewClient/cubeViewerMonaco/state';
import { wireViewPicker, syncReloadViewEnabled } from '../webviewClient/cubeViewerMonaco/viewPicker';

describe('viewPicker.ts — "Reload view" after a pivot', () => {
  beforeEach(() => {
    postMessageSpy.mockReset();
    showLoadingSpy.mockReset();
    viewSelect.handlers = {};
    btnReloadView.handlers = {};
    viewSelect.value = '__none__';
    btnReloadView.disabled = false;
    state.existingViewName = null;
    state.existingViewIsPrivate = false;
    state.loading = false;
    wireViewPicker();
  });

  it('loads the view standing in the dropdown, although the pivot released the binding', () => {
    viewSelect.value = 'pub:Umsatz';
    state.existingViewName = null; // as after `swapAxes` / `moveDimToZone`
    state.existingViewIsPrivate = false;

    btnReloadView.fire('click');

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'switchView', viewName: 'Umsatz', isPrivate: false, reqId: expect.any(Number),
    });
    expect(showLoadingSpy).toHaveBeenCalledWith(true);
  });

  it('carries the private origin along from the dropdown value', () => {
    viewSelect.value = 'priv:Meine Sicht';
    state.existingViewName = null;

    btnReloadView.fire('click');

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: 'switchView', viewName: 'Meine Sicht', isPrivate: true, reqId: expect.any(Number),
    });
  });

  it('does nothing for "Own selection"', () => {
    viewSelect.value = '__none__';
    btnReloadView.fire('click');
    expect(postMessageSpy).not.toHaveBeenCalled();
    expect(showLoadingSpy).not.toHaveBeenCalled();
  });

  it('stays armed after the pivot — the enablement hangs on the dropdown, not on the state', () => {
    viewSelect.value = 'pub:Umsatz';
    state.existingViewName = null;
    syncReloadViewEnabled();
    expect(btnReloadView.disabled).toBe(false);
  });
});
