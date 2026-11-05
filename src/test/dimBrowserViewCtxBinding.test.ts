import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    ctxOnlyThis: 'Only this element', ctxOnlyThese: 'Only these elements{0}',
  };
});

/**
 * The parent submenu is bound ONCE, not on every right-click.
 *
 * Until 2026-08-24 the `addEventListener` on the container sat INSIDE `openMenu()`,
 * and `openMenu()` runs from the `contextmenu` handler: after ten right-clicks
 * ten listeners were attached to the same container, and one click on a parent
 * entry fired ten `pickParent` calls — ten intents on the stack and ten
 * server requests.
 */

interface Stub {
  id: string;
  innerHTML: string; textContent: string;
  style: Record<string, string>;
  dataset: Record<string, string>;
  classList: { toggle(c: string, an?: boolean): void; add(c: string): void; remove(c: string): void };
  offsetWidth: number; offsetHeight: number;
  scrollTop: number; clientHeight: number; scrollHeight: number;
  _h: Record<string, Array<(e: unknown) => void>>;
  addEventListener(t: string, h: (e: unknown) => void): void;
  children: Stub[];
  appendChild(c: Stub): void;
  setAttribute(n: string, v: string): void;
  insertAdjacentHTML(p: string, h: string): void;
  querySelectorAll(): unknown[];
  querySelector(): unknown;
}

function stub(id: string): Stub {
  return {
    id, innerHTML: '', textContent: '', style: {}, dataset: {},
    classList: { toggle: () => {}, add: () => {}, remove: () => {} },
    offsetWidth: 10, offsetHeight: 10,
    scrollTop: 0, clientHeight: 100, scrollHeight: 100,
    _h: {},
    addEventListener(t, h) { (this._h[t] ??= []).push(h); },
    children: [],
    appendChild(c) { this.children.push(c); },
    setAttribute: () => {},
    insertAdjacentHTML: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

describe('the parent submenu is bound once', () => {
  let els: Record<string, Stub>;
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetModules();
    els = {}; posts = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (els[id] ??= stub(id)),
      addEventListener: () => {},
    };
    (globalThis as unknown as { window: unknown }).window = { innerWidth: 800, innerHeight: 600 };
  });

  it('two right-clicks, one click on a parent entry = ONE pickParent', async () => {
    const viewPath = await import('../webviewClient/dimensionBrowser/viewPath');
    const { initViewCtx } = await import('../webviewClient/dimensionBrowser/viewCtx');
    viewPath._resetViewPathForTest();
    viewPath.startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    viewPath.onViewRows({
      type: 'viewRows', requestId: Number(posts[0].requestId), dimName: 'd', hierName: 'h',
      ok: true, hasMore: false,
      rows: [{ name: 'a', caption: 'a', type: 'N', level: 0, parent: null, drilled: false, ancestors: [] }],
    } as never);
    initViewCtx();

    const zeile = { getAttribute: () => '0' };
    const rechtsklick = els['table-body']._h.contextmenu![0]!;
    const ev = { target: { closest: () => zeile }, clientX: 1, clientY: 1, preventDefault: () => {} };
    // Open twice — exactly the sequence that used to attach a second listener.
    rechtsklick(ev);
    rechtsklick(ev);

    const host = els['ctx-show-parents-sub'];
    expect(host._h.click, 'Bindung am Behaelter').toHaveLength(1);

    const vorher = posts.length;
    host._h.click![0]!({ target: { dataset: { parent: 'P' } } });
    // Exactly ONE new request — `pickParent` → `pickParentAt` → `pushIntent` → `fetchRows()`.
    const neue = posts.slice(vorher).filter((p) => p.type === 'fetchViewRows');
    expect(neue).toHaveLength(1);
  });
});

/**
 * The parent submenu is usable on the FIRST right-click.
 *
 * Until 2026-08-25 only the CLICK on the entry fetched the parent list — and
 * `hide()` ran before that, so the answer filled an invisible submenu.
 * Because the submenu only opens via CSS on `.ctx-multi:hover` and only the
 * answer sets `ctx-multi`, the first right-click did not even show the
 * arrow; on the second, the parents of the FIRST element were shown
 * (click test by flameY3T1: "laedt das Dropdown erst nach einmal klicken" —
 * the dropdown only loads after clicking once).
 */
describe('the parent list is ready when the menu opens', () => {
  let els: Record<string, Stub>;
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetModules();
    els = {}; posts = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => (els[id] ??= stub(id)),
      createElement: () => stub('neu'),
      addEventListener: () => {},
    };
    (globalThis as unknown as { window: unknown }).window = { innerWidth: 800, innerHeight: 600 };
  });

  /** Set up two rows and wire the menu. */
  async function aufbau() {
    const viewPath = await import('../webviewClient/dimensionBrowser/viewPath');
    const { initViewCtx } = await import('../webviewClient/dimensionBrowser/viewCtx');
    const parentPick = await import('../webviewClient/dimensionBrowser/parentPick');
    viewPath._resetViewPathForTest();
    viewPath.startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    viewPath.onViewRows({
      type: 'viewRows', requestId: Number(posts[0].requestId), dimName: 'd', hierName: 'h',
      ok: true, hasMore: false,
      rows: ['a', 'b'].map((n) => ({
        name: n, caption: n, type: 'N', level: 0, parent: null, drilled: false, ancestors: [],
      })),
    } as never);
    initViewCtx();
    const rechtsklick = els['table-body']._h.contextmenu![0]!;
    const auf = (idx: string) => rechtsklick({
      target: { closest: () => ({ getAttribute: () => idx }) },
      clientX: 1, clientY: 1, preventDefault: () => {},
    });
    return { viewPath, parentPick, auf };
  }

  it('asks for the parents already when opening, not only on click', async () => {
    const { auf } = await aufbau();
    auf('0');
    const fragen = posts.filter((p) => p.type === 'drillAncestors');
    expect(fragen).toHaveLength(1);
    expect(fragen[0]!.element).toBe('a');
    // `recursive: false` — only the direct parents, a targeted query.
    expect(fragen[0]!.recursive).toBe(false);
  });

  it('asks exactly once per right-click, and for the RIGHT element', async () => {
    const { auf } = await aufbau();
    auf('0'); auf('1');
    const fragen = posts.filter((p) => p.type === 'drillAncestors');
    expect(fragen.map((f) => f.element)).toEqual(['a', 'b']);
  });

  it('clears the list of the previous element when opening', async () => {
    const { parentPick, auf } = await aufbau();
    auf('0');
    parentPick.showParentPicks(['sum', 'd'], 'a');
    expect(parentPick.parentPicksFor('a')).toEqual(['sum', 'd']);
    // Next right-click on a DIFFERENT element: the old list is gone.
    auf('1');
    expect(parentPick.parentPicksFor('a')).toBeNull();
    expect(els['ctx-show-parents-sub'].innerHTML).toBe('');
  });

  it('exactly ONE parent: clicking the entry takes it directly', async () => {
    // With one parent there is no submenu (`ctx-multi` stays off) —
    // the entry itself must take it, otherwise it is unreachable.
    const { viewPath, parentPick, auf } = await aufbau();
    auf('0');
    parentPick.showParentPicks(['sum'], 'a');
    const vorher = posts.length;
    els['ctx-show-parents']._h.click![0]!({});
    expect(posts.slice(vorher).filter((p) => p.type === 'fetchViewRows')).toHaveLength(1);
    expect(viewPath.currentMdx()).toBe('{UNION({[d].[h].[sum]}, {[d].[h].Members}, ALL)}');
  });

  it('several parents: clicking the entry picks NOTHING', async () => {
    // The submenu is the choice. Otherwise a click on the row itself would
    // silently take the first parent that comes along.
    const { parentPick, auf } = await aufbau();
    auf('0');
    parentPick.showParentPicks(['sum', 'd'], 'a');
    const vorher = posts.length;
    els['ctx-show-parents']._h.click![0]!({});
    expect(posts.slice(vorher).filter((p) => p.type === 'fetchViewRows')).toHaveLength(0);
  });

  it('no answer yet: the click does NOT ask a second time', async () => {

    const { auf } = await aufbau();
    auf('0');
    const vorher = posts.length;
    els['ctx-show-parents']._h.click![0]!({});
    expect(posts.slice(vorher).filter((p) => p.type === 'drillAncestors')).toHaveLength(0);
  });
});
