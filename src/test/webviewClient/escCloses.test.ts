// Escape closes an open modal and only that one (review 2026-09-23, W7).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { escCloses } from '../../webviewClient/_shared/escCloses';

type Handler = (e: KeyboardEvent) => void;

function rig(open: boolean) {
  const added: Array<{ fn: Handler; capture: unknown }> = [];
  vi.stubGlobal('document', { addEventListener: (_t: string, fn: Handler, capture: unknown) => added.push({ fn, capture }) });
  const cls = new Set(open ? ['visible'] : []);
  const modal = { classList: { contains: (c: string) => cls.has(c) } } as unknown as HTMLElement;
  const close = vi.fn();
  escCloses(modal, close);
  const press = (key: string) => {
    const e = { key, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    added[0].fn(e as unknown as KeyboardEvent);
    return e;
  };
  return { added, close, press };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('escCloses', () => {
  it('listens in the capture phase so a focus on body still reaches it', () => {
    expect(rig(true).added[0].capture).toBe(true);
  });

  it('closes the open modal and stops background Escape handlers', () => {
    const r = rig(true);
    const e = r.press('Escape');
    expect(r.close).toHaveBeenCalledTimes(1);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('leaves other keys and a closed modal alone', () => {
    const open = rig(true);
    expect(open.press('Enter').stopImmediatePropagation).not.toHaveBeenCalled();
    const closed = rig(false);
    expect(closed.press('Escape').stopImmediatePropagation).not.toHaveBeenCalled();
    expect(open.close).not.toHaveBeenCalled();
    expect(closed.close).not.toHaveBeenCalled();
  });
});
