import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { state } from '../webviewClient/dimensionBrowser/state';
import { sessionHandlers } from '../webviewClient/dimensionBrowser/msgSession';
import type { HostToWebview } from '../webviewClient/dimensionBrowser/protocol';

/**
 * The way into the Dimension Editor is open in selection mode as well.
 *
 * Until 2026-08-12 `setMode` hid the button there ("selecting elements is
 * not editing"). But whoever jumps from the Cube Viewer into the browser sees
 * the same dimension and has the same reason to open it (click test
 * flameY3T1). The hierarchy picker stays hidden — it belongs to the caller's
 * preselection.
 */

interface FakeEl { style: { display: string }; classList: { add: (c: string) => void } }

let els: Record<string, FakeEl>;

function el(id: string): FakeEl {
  if (!els[id]) { els[id] = { style: { display: '' }, classList: { add: () => {} } }; }
  return els[id];
}

beforeEach(() => {
  els = {};
  (globalThis as unknown as Record<string, unknown>).document = {
    getElementById: (id: string) => el(id),
    body: { classList: { add: () => {} } },
  };
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).document;
  state._mode = 'browse';
});

function setMode(mode: string, hierSwitch?: { taken: string[] }): void {
  (sessionHandlers.setMode as (m: HostToWebview) => void)({
    type: 'setMode', mode, dimName: 'Konten', hierName: 'Konten', hierSwitch,
  } as unknown as HostToWebview);
}

describe('Dimension Editor from selection mode', () => {
  it('selection mode does NOT hide the editor button', () => {
    setMode('selection');
    expect(el('open-dim-editor-btn').style.display).not.toBe('none');
  });

  it('selection mode shows the hierarchy picker, locked', () => {
    setMode('selection');
    expect(el('hier-select').style.display).not.toBe('none');
    expect(el('hier-label').style.display).not.toBe('none');
    expect((el('hier-select') as HTMLSelectElement).disabled).toBe(true);
  });

  it('selection mode with hierSwitch unlocks the picker and greys out taken hierarchies', () => {
    const opts = [{ value: 'Konten', disabled: false }, { value: 'Alt', disabled: false }];
    Object.assign(el('hier-select'), { options: opts });
    state._currentHier = 'Konten';
    setMode('selection', { taken: ['Alt'] });
    expect((el('hier-select') as unknown as HTMLSelectElement).disabled).toBe(false);
    expect(opts.map((o) => o.disabled)).toEqual([false, true]);
  });

  it('in browse mode nothing is hidden anyway', () => {
    setMode('browse');
    expect(el('open-dim-editor-btn').style.display).not.toBe('none');
    expect(el('hier-select').style.display).not.toBe('none');
  });
});
