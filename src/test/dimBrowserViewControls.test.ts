import { describe, it, expect, beforeEach, vi } from 'vitest';

const ALT = ['btn-show-all', 'btn-keep-marked', 'btn-remove-marked', 'mark-count',
  'quick-only-n', 'quick-only-c', 'quick-only-s', 'filter-input',
  'attr-name-filter', 'attr-val-filter', 'attr-name-label', 'alias-select', 'alias-label',
  'sort-mode', 'sort-label', 'level-filter', 'level-label'];
const NEU = ['vw-btn-base-members', 'vw-btn-base-all', 'vw-btn-keep', 'vw-btn-remove',
  'vw-quick-n', 'vw-quick-c', 'vw-quick-s', 'vw-mark-count', 'vw-filter-input',
  'vw-attr-name', 'vw-attr-value', 'vw-attr-label',
  'vw-filter-apply', 'vw-attr-apply', 'vw-alias', 'vw-alias-label',
  'vw-sort', 'vw-level'];

function bauDom() {
  const els: Record<string, { style: Record<string, string>; disabled: boolean;
    klassen: Set<string>; attrs: Record<string, string>;
    classList: { toggle(c: string, an?: boolean): void };
    setAttribute(n: string, v: string): void;
    _h: null | ((e: unknown) => void); addEventListener(t: string, h: (e: unknown) => void): void }> = {};
  for (const id of ALT.concat(NEU)) {
    const klassen = new Set<string>();
    const attrs: Record<string, string> = {};
    els[id] = {
      style: { display: '' }, disabled: false, _h: null,
      klassen, attrs,
      classList: {
        toggle(c, an) { if (an ?? !klassen.has(c)) { klassen.add(c); } else { klassen.delete(c); } },
      },
      setAttribute(n, v) { attrs[n] = v; },
      addEventListener(_t, h) { this._h = h; },
    };
  }
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    // Task 6: the checkbox list binds an outside-click closer to the
    // document — the stub is enough for these tests, they do not check it.
    addEventListener: () => {},
  };
  return els;
}

describe('initViewControls separates the bars cleanly', () => {
  beforeEach(() => { vi.resetModules(); });

  const stummel = {
    setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
    applyLayer: () => {}, previewLayer: () => {}, setAlias: () => {}, setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
  };

  it('hides the old controls and shows the new ones', async () => {
    const els = bauDom();
    const { initViewControls } = await import('../webviewClient/dimensionBrowser/viewControls');
    initViewControls(stummel);
    for (const id of ALT) { expect(els[id].style.display, id).toBe('none'); }
    for (const id of NEU) { expect(els[id].style.display, id).not.toBe('none'); }
  });

  it('Keep and Remove are disabled without marks', async () => {
    const els = bauDom();
    const { initViewControls, syncViewControls } =
      await import('../webviewClient/dimensionBrowser/viewControls');
    const marks = await import('../webviewClient/dimensionBrowser/viewMarks');
    marks._resetMarksForTest();
    initViewControls(stummel);
    syncViewControls();
    expect(els['vw-btn-keep'].disabled).toBe(true);
    expect(els['vw-btn-remove'].disabled).toBe(true);
  });

  it('with marks they are enabled', async () => {
    const els = bauDom();
    const { initViewControls, syncViewControls } =
      await import('../webviewClient/dimensionBrowser/viewControls');
    const marks = await import('../webviewClient/dimensionBrowser/viewMarks');
    marks._resetMarksForTest();
    marks.toggleMark('a');
    initViewControls(stummel);
    syncViewControls();
    expect(els['vw-btn-keep'].disabled).toBe(false);
    expect(els['vw-btn-remove'].disabled).toBe(false);
  });
});

/**
 * Important 2 (final review): `dimBrowserViewControls.test.ts` used to only
 * capture the handlers in `_h` (proof that ONE click is bound), but
 * never called them — an `el('vw-btn-keep')` that pointed to a different
 * id due to a typo would have stayed silently green (mutation-tested: renaming the id in the
 * `bind('vw-btn-keep', ...)` line turned no test red).
 * These tests call every `_h` themselves and check the RIGHT callback
 * WITH the right argument — not just "some callback fired".
 */
describe('every button calls exactly its callback with the right argument', () => {
  beforeEach(() => { vi.resetModules(); });

  async function bindAlle() {
    const els = bauDom();
    const cbs = {
      setBase: vi.fn(), keepMarked: vi.fn(), removeMarked: vi.fn(), applyLayer: vi.fn(), previewLayer: vi.fn(), setAlias: vi.fn(), setSort: vi.fn(), setLevel: vi.fn(), setAttrColumns: vi.fn(),
    };
    const { initViewControls } = await import('../webviewClient/dimensionBrowser/viewControls');
    initViewControls(cbs);
    return { els, cbs };
  }

  function feuere(els: ReturnType<typeof bauDom>, id: string): void {
    expect(els[id]._h, `${id} hat keinen Handler gebunden`).not.toBeNull();
    els[id]._h!({});
  }

  it("vw-btn-base-members calls setBase('tree')", async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-btn-base-members');
    expect(cbs.setBase).toHaveBeenCalledWith('tree');
    expect(cbs.keepMarked).not.toHaveBeenCalled();
  });

  it("vw-btn-base-all calls setBase('set')", async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-btn-base-all');
    expect(cbs.setBase).toHaveBeenCalledWith('set');
  });

  it('vw-btn-keep calls keepMarked', async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-btn-keep');
    expect(cbs.keepMarked).toHaveBeenCalledTimes(1);
    expect(cbs.removeMarked).not.toHaveBeenCalled();
  });

  it('vw-btn-remove calls removeMarked', async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-btn-remove');
    expect(cbs.removeMarked).toHaveBeenCalledTimes(1);
    expect(cbs.keepMarked).not.toHaveBeenCalled();
  });

  it("vw-quick-n calls applyLayer with {kind:'type', types:['N']}", async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-quick-n');
    expect(cbs.applyLayer).toHaveBeenCalledWith({ kind: 'type', types: ['N'] });
  });

  it("vw-quick-c calls applyLayer with {kind:'type', types:['C']}", async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-quick-c');
    expect(cbs.applyLayer).toHaveBeenCalledWith({ kind: 'type', types: ['C'] });
  });

  it("vw-quick-s calls applyLayer with {kind:'type', types:['S']}", async () => {
    const { els, cbs } = await bindAlle();
    feuere(els, 'vw-quick-s');
    expect(cbs.applyLayer).toHaveBeenCalledWith({ kind: 'type', types: ['S'] });
  });
});

/**
 * The failure itself: an id that does not exist in the markup (a typo
 * or a later rename) must NOT be swallowed silently — see
 * `bind()` in `viewControls.ts`.
 */
describe('a missing id reports itself loudly instead of staying silent', () => {
  beforeEach(() => { vi.resetModules(); });

  it('console.warn names the missing id', async () => {
    const els = bauDom();
    delete (els as Record<string, unknown>)['vw-btn-keep'];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initViewControls } = await import('../webviewClient/dimensionBrowser/viewControls');
    initViewControls({
      setBase: vi.fn(), keepMarked: vi.fn(), removeMarked: vi.fn(),
      applyLayer: vi.fn(), previewLayer: vi.fn(), setAlias: vi.fn(), setSort: vi.fn(), setLevel: vi.fn(), setAttrColumns: vi.fn(),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('vw-btn-keep'));
    warn.mockRestore();
  });
});
