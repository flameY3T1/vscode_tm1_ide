/**
 * The REQUEST SHAPE of the two host paths that used to be the browser's most
 * expensive calls (Stufe-2 review, 2026-08-02):
 *
 *  - S2-1 `drillAncestors` ("Eltern anzeigen") pulled the WHOLE `/Edges`
 *    collection of the hierarchy — 419k rows on the documented dimensions —
 *    just to learn one element's parent chain, then fired one extra single-key
 *    GET per ancestor. It now walks upward level by level with the same
 *    `Elements?$select=…&$expand=Parents($select=Name)` batch query
 *    `_fetchMemberStructure` uses, so type and level come back with the parents.
 *  - S2-2 `runSubsetMdx` CREATED a temporary PrivateSubset on the server (POST),
 *    read it back, and deleted it again. A write plus three round trips for a
 *    read-only question — and a failing DELETE left `_tm1ti_dimbrw_*` corpses
 *    behind. It now goes through `ExecuteMDXSetExpression`, the same POST
 *    `_fetchElementPageMdx` already uses.
 *
 * These tests pin the WIRE FORM, not just the result: a regression that quietly
 * reintroduces the edge dump or the temp subset would still produce the right
 * elements, which is exactly why the old shape survived so long.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// S2-8 (review 2026-08-02): the REST half of the browser now lives in
// `tm1Rest/dimension{Elements,Tree}Api` + `tm1Rest/odataPaging`, which import the
// transport DIRECTLY — the `no-tm1client-in-deep-layers` rule forbids the facade
// below `commands/`. Point the deep path at the SAME doubles, or these tests
// reach the network and time out instead of failing.
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../commands/dimension/dimensionBrowserWebview', () => ({ getHtml: vi.fn(() => '<html></html>') }));
vi.mock('../commands/serverManager', () => ({
  getServerNameByUrl: vi.fn(() => 'Srv'),
  formatServerLabel: vi.fn(() => 'Srv'),
}));
vi.mock('../commands/mdx/mdxRunner', () => ({ MdxRunnerManager: { openWithMdx: vi.fn() } }));
vi.mock('../tm1Rest/dimensionApi', () => ({
  listDimensionNames: vi.fn(),
  listHierarchyNames: vi.fn(),
}));
vi.mock('../tm1Rest/cubeApi', () => ({ getCube: vi.fn() }));
vi.mock('../tm1Rest/subsetApi', () => ({
  listSubsetNames: vi.fn(),
  listSubsetInfos: vi.fn(),
  subsetExists: vi.fn(),
  deleteSubset: vi.fn(),
  createSubset: vi.fn(),
  listSubsetElementNames: vi.fn(),
  getSubset: vi.fn(),
}));

import { _handleMessage } from '../commands/dimension/dimensionBrowser';
import { apiRequest } from '../tm1Client';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
};

interface FakePanel {
  title: string;
  webview: { postMessage: ReturnType<typeof vi.fn> };
  dispose: ReturnType<typeof vi.fn>;
}
function fakePanel(): FakePanel {
  return { title: '', webview: { postMessage: vi.fn() }, dispose: vi.fn() };
}
const posted = (p: FakePanel): Array<Record<string, unknown>> =>
  p.webview.postMessage.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);

type Call = [string, string, string | undefined];
const calls = (): Call[] =>
  vi.mocked(apiRequest).mock.calls.map((c) => [String(c[0]), String(c[1]), c[2] as string | undefined]);

/** The `$filter=` value of a recorded request, decoded. */
function filterOf(url: string): string {
  const m = /[&?]\$filter=([^&]*)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Element rows as TM1 answers a `$select=Name,Type,Level&$expand=Parents` query. */
function parentsBody(rows: Array<{ Name: string; Type?: string; Level?: number; Parents?: string[] }>): string {
  return JSON.stringify({
    value: rows.map((r) => ({
      Name: r.Name,
      Type: r.Type ?? 'Consolidated',
      Level: r.Level ?? 1,
      Parents: (r.Parents ?? []).map((p) => ({ Name: p })),
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── S2-1 ────────────────────────────────────────────────────────────────────
describe('drillAncestors — batched $expand=Parents instead of the whole /Edges dump', () => {
  /** Hierarchy: GP → P1 → E, GP → P2 → E. */
  const PARENTS: Record<string, string[]> = { E: ['P1', 'P2'], P1: ['GP'], P2: ['GP'], GP: [] };

  function mockHierarchy(): void {
    vi.mocked(apiRequest).mockImplementation((async (_m: string, url: string) => {
      const asked = Array.from(filterOf(String(url)).matchAll(/Name eq '([^']*)'/g)).map((m) => m[1]);
      return {
        statusCode: 200,
        body: parentsBody(asked.map((n) => ({ Name: n, Parents: PARENTS[n] ?? [] }))),
      };
    }) as never);
  }

  it('never reads the hierarchy /Edges collection', async () => {
    mockHierarchy();
    await _handleMessage(
      fakePanel() as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never,
      CONFIG,
    );
    expect(calls().filter(([, url]) => url.includes('/Edges'))).toEqual([]);
  });

  it('asks for parents AND type/level in one query per level, by name filter', async () => {
    mockHierarchy();
    await _handleMessage(
      fakePanel() as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never,
      CONFIG,
    );
    const urls = calls().map(([, url]) => url);
    for (const url of urls) {
      expect(url).toContain('$expand=Parents($select=Name)');
      expect(url).toContain('$select=Name,Type,Level');
      expect(url).toContain('$filter=');
    }
    // level 0 = the clicked element, level 1 = its parents, level 2 = GP.
    // Three round trips for a three-level chain — not one per ancestor.
    expect(urls).toHaveLength(3);
    expect(filterOf(urls[0])).toBe("Name eq 'E'");
    expect(filterOf(urls[1])).toBe("Name eq 'P1' or Name eq 'P2'");
    expect(filterOf(urls[2])).toBe("Name eq 'GP'");
  });

  it('no single-key Elements(...) GET per ancestor survives', async () => {
    mockHierarchy();
    await _handleMessage(
      fakePanel() as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never,
      CONFIG,
    );
    expect(calls().filter(([, url]) => /Elements\('[^']+'\)/.test(url))).toEqual([]);
  });

  it('recursive — same ancestors and path edges as the edge-dump walk produced', async () => {
    mockHierarchy();
    const p = fakePanel();
    await _handleMessage(
      p as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never,
      CONFIG,
    );
    const sent = posted(p).find((m) => m.type === 'ancestors') as unknown as {
      elements: Array<{ Name: string; Type: string }>; edges: Array<{ ParentName: string; ComponentName: string }>;
    };
    expect(sent.elements.map((e) => e.Name)).toEqual(['P1', 'P2', 'GP']); // BFS order
    expect(sent.elements.every((e) => e.Type === 'C')).toBe(true);        // type came along
    expect(sent.edges.map((e) => e.ParentName + '>' + e.ComponentName)).toEqual(
      ['P1>E', 'P2>E', 'GP>P1', 'GP>P2']);
  });

  it('non-recursive — one hop of edges, but still the parents own type/level', async () => {
    mockHierarchy();
    const p = fakePanel();
    await _handleMessage(
      p as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: false } as never,
      CONFIG,
    );
    const sent = posted(p).find((m) => m.type === 'ancestors') as unknown as {
      elements: Array<{ Name: string; Type: string; Level: number }>; edges: unknown[];
    };
    expect(sent.elements.map((e) => e.Name)).toEqual(['P1', 'P2']); // GP NOT walked
    expect(sent.edges).toEqual([
      { ParentName: 'P1', ComponentName: 'E' },
      { ParentName: 'P2', ComponentName: 'E' },
    ]);
    // The second round exists ONLY to learn P1/P2's type+level — it must not
    // walk on. Two requests: the element, then its parents.
    expect(calls()).toHaveLength(2);
    expect(sent.elements[0].Type).toBe('C');
  });

  it('a failing level is reported, not silently answered flat', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 500, body: 'boom' } as never);
    const p = fakePanel();
    await _handleMessage(
      p as never,
      { type: 'drillAncestors', dimName: 'D', hierName: 'D', element: 'E', recursive: true } as never,
      CONFIG,
    );
    // The handler's own catch answers empty + warns; what matters here is that
    // the fetch does NOT swallow the failure into an empty happy path.
    expect(posted(p)).toContainEqual(expect.objectContaining({ type: 'ancestors', elements: [], edges: [] }));
  });
});

// ── S2-2 ────────────────────────────────────────────────────────────────────
