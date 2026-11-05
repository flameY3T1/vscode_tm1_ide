import { describe, it, expect, vi, beforeEach } from 'vitest';

// Since 2026-08-22 the counter takes its text from the bundle (`loaded`
// = "{0} of {1} loaded") instead of building it in hard-coded German. The map comes BEFORE
// the import, because `viewPath` fetches it when the module loads.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = {
    loaded: '{0} von {1}',
    statVisible: 'sichtbar', statTotal: 'gesamt', vwStatInWindow: 'im Fenster',
  };
});


// BOTH paths on the same double: modules under `tm1Rest/` import the
// transport directly, because `no-tm1client-in-deep-layers` forbids them the facade.
// A test that only mocks the facade lets them run into the real network
// and ends in timeouts instead of a clear error (docs/architecture/import-rules.md).
vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { fetchViewCount } from '../tm1Rest/dimensionElementsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg = {
  serverUrl: 'https://example:1', username: 'u', password: 'p', authType: 'basic',
} as unknown as Tm1Config;

describe('fetchViewCount', () => {
  beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

  it('requests ONLY Cardinality, without $expand', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200, body: JSON.stringify({ Cardinality: 803808 }),
    } as never);
    const total = await fetchViewCount('{[d].[h].Members}', cfg);
    expect(total).toBe(803808);
    const url = String(vi.mocked(apiRequest).mock.calls[0][1]);
    expect(url).toContain('$select=Cardinality');
    // The whole point: a 112-byte answer instead of megabytes. A `$expand=Tuples`
    // here would make the extra request as expensive as fetching the rows.
    expect(url).not.toContain('$expand');
  });

  it('reports -1 when the server sends no number', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({}) } as never);
    expect(await fetchViewCount('{[d].[h].Members}', cfg)).toBe(-1);
  });

  it('throws with TM1\'s own message when the expression does not parse', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { message: 'Syntax error near token X' } }),
    } as never);
    await expect(fetchViewCount('{kaputt}', cfg)).rejects.toThrow('Syntax error near token X');
  });
});

import {
  startView, onViewRows, onViewCount, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

/** A minimal `<tr>` node for the test double, see `parseTrs`. */
interface FakeTr {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Tiny `<tr>` parser for the test double.
 *
 * `document` does not exist in tests, but `drawWindow` (`viewPath.ts`)
 * rewrites `innerHTML` completely — a `querySelectorAll: () => []`
 * dud would let the test only check that the call does not throw, not
 * what it writes into the markup (finding round 1). Good enough for our own,
 * controlled markup (double quotes, no nested
 * `<tr>`).
 */
function parseTrs(html: string): FakeTr[] {
  const out: FakeTr[] = [];
  const trOpenRe = /<tr\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = trOpenRe.exec(html)) !== null) {
    const attrs = new Map<string, string>();
    const attrRe = /([\w-]+)="([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(m[1])) !== null) { attrs.set(am[1], am[2]); }
    out.push({
      getAttribute: (name) => (attrs.has(name) ? (attrs.get(name) ?? null) : null),
      setAttribute: (name, value) => { attrs.set(name, value); },
      removeAttribute: (name) => { attrs.delete(name); },
    });
  }
  return out;
}

interface FakeCountEl {
  textContent: string;
  innerHTML: string;
  style: Record<string, string>;
  // The counter and the toggles touch both; without them the double fails with
  // a TypeError instead of checking behaviour.
  classList: { contains(): boolean; toggle(): void; add(): void; remove(): void };
  setAttribute(): void;
  addEventListener(): void;
  insertAdjacentHTML(p: string, h: string): void;
  querySelectorAll(sel: string): FakeTr[];
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

function fakeCountEl(): FakeCountEl {
  let html = '';
  let trs: FakeTr[] = [];
  const el: FakeCountEl = {
    textContent: '',
    // Set = re-derive the truth for `querySelectorAll('tr')`: every
    // `innerHTML =` (every call of `drawWindow`) re-parses here,
    // exactly as in the real DOM — since then the rows carry their `aria-setsize`
    // in the freshly drawn markup, not as an attribute mutated afterwards
    // on nodes that were left standing.
    get innerHTML() { return html; },
    set innerHTML(h: string) { html = h; trs = parseTrs(h); },
    style: {},
    // The counter and the toggles touch `classList`/`setAttribute` — a double
    // without both fails with a TypeError instead of checking the behaviour.
    classList: { contains: () => false, toggle: () => {}, add: () => {}, remove: () => {} },
    setAttribute() {},
    addEventListener() {},
    insertAdjacentHTML(_p: string, h: string) { el.innerHTML += h; },
    querySelectorAll: (sel: string) => (sel === 'tr' ? trs : []),
    scrollTop: 0, clientHeight: 0, scrollHeight: 0,
  };
  return el;
}

describe('the counter runs alongside the rows', () => {
  let els: Record<string, FakeCountEl>;
  let posts: Array<Record<string, unknown>>;

  beforeEach(() => {
    _resetViewPathForTest();
    els = {};
    posts = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: (id: string) => {
        if (!els[id]) { els[id] = fakeCountEl(); }
        return els[id];
      },
    };
  });

  it('requests rows AND the count, but separately', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    // Since the attribute filter, `fetchAttrDefs` runs afterwards — AFTER the
    // rows, because it only fills a select field.
    expect(posts.map((p) => p.type))
      .toEqual(['fetchViewRows', 'fetchViewCount', 'fetchAttrDefs', 'fetchLevels']);
    // The count queries the UNwindowed expression: no SUBSET in it.
    expect(String(posts[1].mdx)).not.toContain('SUBSET');
  });

  it('shows the loaded count alone first, then both', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    onViewRows({
      type: 'viewRows', requestId: Number(posts[0].requestId), dimName: 'd', hierName: 'h',
      ok: true, hasMore: true,
      rows: [{ name: 'a', caption: 'a', type: 'N', level: 0, parent: null, drilled: false, ancestors: [] }],
    } as never);
    // Neither the counter at the top right nor the header counters exist
    // anymore: they said the same as the footer. The double creates elements
    // only on access — so `undefined` proves that nobody writes
    // there anymore.
    expect(els['element-count']).toBeUndefined();
    expect(els['source-count']).toBeUndefined();
    expect(els['source-total']).toBeUndefined();
    // The footer carries the number. Number and label are two nodes —
    // the counter writes `textContent`, no longer `innerHTML`.
    expect(els['stat-visible-n'].textContent).toBe('1');

    onViewCount({
      type: 'viewCount', requestId: Number(posts[1].requestId),
      dimName: 'd', hierName: 'h', ok: true, total: 42,
    } as never);
    expect(els['element-count']).toBeUndefined();
    expect(els['stat-visible-n'].textContent).toBe('1');
    expect(els['stat-total-n'].textContent).toBe('42');
    // N/C/S count the LOADED window — the label says so.
    expect(els['stat-n-n'].textContent).toBe('1');
    expect(els['stat-n-t'].textContent).toBe('N im Fenster');
    expect(els['stat-c-n'].textContent).toBe('0');
    expect(els['stat-c-t'].textContent).toBe('C im Fenster');
  });

  it('updates aria-setsize on the rows already shown when the count arrives later', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    onViewRows({
      type: 'viewRows', requestId: Number(posts[0].requestId), dimName: 'd', hierName: 'h',
      ok: true, hasMore: false,
      rows: [{ name: 'a', caption: 'a', type: 'N', level: 0, parent: null, drilled: false, ancestors: [] }],
    } as never);
    const vorher = els['table-body'].querySelectorAll('tr');
    expect(vorher).toHaveLength(1);
    // As long as the count is still on its way, the row already shown has NO
    // aria-setsize — a guessed number would be more wrong than a missing one.
    expect(vorher[0].getAttribute('aria-setsize')).toBeNull();

    onViewCount({
      type: 'viewCount', requestId: Number(posts[1].requestId),
      dimName: 'd', hierName: 'h', ok: true, total: 42,
    } as never);

    // Redrawn (task 4: `drawWindow` always rewrites `innerHTML`
    // completely) — the row count stays the same, and the `aria-setsize`
    // now sits in the markup, because `total` was already available when drawing.
    const nachher = els['table-body'].querySelectorAll('tr');
    expect(nachher).toHaveLength(1);
    expect(nachher[0].getAttribute('aria-setsize')).toBe('42');
  });

  it('a superseded count no longer writes', () => {
    startView('d', 'h', (m) => posts.push(m as Record<string, unknown>));
    const alteId = Number(posts[1].requestId);
    onViewCount({
      type: 'viewCount', requestId: alteId - 99,
      dimName: 'd', hierName: 'h', ok: true, total: 7,
    } as never);
    // The guard (`msg.requestId !== countRequestId`) kicks in BEFORE any DOM access
    // — `#element-count` stays completely untouched in this scenario.
    // `?? ''` covers both: untouched (our expectation here) AND written
    // empty; both mean "the superseded answer had no effect".
    expect(els['element-count']?.textContent ?? '').toBe('');
  });
});
