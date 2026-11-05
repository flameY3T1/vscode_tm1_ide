import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: vi.mock factories run BEFORE module top-level constants — without
// it, accessing `apiRequest` inside the factory fails with
// "Cannot access before initialization".
//
// `assertOk` has to be shipped along: `resolvePicklist` (Task 6, fix
// round 1) passes a `label` through to `odataPaging.ts#fetchAllPages`, and
// that fetches `assertOk` from THE SAME `tm1Rest/client` module — a mock
// that only exports `apiRequest` makes the access to `assertOk` blow up with
// Vitest's "not mocked" error, regardless of the status code.
const { apiRequest, assertOk } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn((res: { statusCode: number; body: string }, context?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = context ? `${context}: ` : '';
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${res.body}`);
    }
  }),
}));
vi.mock('../../tm1Rest/client', () => ({ apiRequest, assertOk }));
vi.mock('../../tm1Client', () => ({ apiRequest, assertOk }));
// Fix round 1: a skipped read now reports itself on the Cube Viewer's
// channel — here as a dummy, so that the text can be checked.
vi.mock('../../commands/cubeViewer/cubeViewerLog', () => ({ logCubeViewer: vi.fn() }));

import {
  hasPicklistCube, fetchRulePicklists, fetchCellPicklist, fetchElementPicklists, resolvePicklist,
  invalidatePicklistResolutions, disposePicklistCachesForServer,
  _clearPicklistCachesForTest,
} from '../../commands/cubeViewer/picklistApi';
import { logCubeViewer } from '../../commands/cubeViewer/cubeViewerLog';

const cfg = { serverUrl: 'https://s:1/api/v1', username: 'u', authType: 'basic' } as never;
/** Response to `hasPicklistCube` — every read path asks it first. */
const CUBE_THERE = { statusCode: 200, body: '{"Name":"}PickList_Plan"}' };

beforeEach(() => {
  apiRequest.mockReset();
  (logCubeViewer as unknown as ReturnType<typeof vi.fn>).mockClear();
  _clearPicklistCachesForTest();
});

describe('hasPicklistCube', () => {
  it('reports true on 200 and remembers the result', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('reports false on 404', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{"error":{}}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(false);
  });

  it('remembers a 404 — "does not exist" is a final answer', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{"error":{}}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(false);
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(false);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT remember a 5xx — "not right now" is not a final answer', async () => {
    apiRequest.mockResolvedValueOnce({ statusCode: 503, body: '{}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(false);
    // The next call asks again and sees the real result.
    apiRequest.mockResolvedValueOnce({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('says on the channel that a 5xx costs the cell level', async () => {
    apiRequest.mockResolvedValue({ statusCode: 503, body: '{}' });
    await hasPicklistCube(cfg, 'Plan');
    const note = (logCubeViewer as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(note).toContain('503');
    expect(note).toContain('Plan');
  });

  it('catches a thrown exception, reports false and does NOT cache', async () => {
    apiRequest.mockRejectedValueOnce(new Error('network'));
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(false);
    // A second call after the outlier asks again (no cache hit)
    // and returns the real result as soon as the server answers again.
    apiRequest.mockResolvedValueOnce({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});

describe('fetchRulePicklists — the whole area costs ONE request', () => {
  // Measured 2026-08-13 (11.8): the rule text costs 1 ms, a grid query
  // over the window of a real view takes over 10 minutes. That is why this
  // is the only area-wide source.
  it('reads the map from the rule text and remembers it', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: "['Status_Maintenance'] = S: 'Dimension:Dropdown';",
      }) });
    expect(await fetchRulePicklists(cfg, 'Plan'))
      .toEqual({ Status_Maintenance: 'Dimension:Dropdown' });
    // Second call: remembered, no further request.
    expect(await fetchRulePicklists(cfg, 'Plan'))
      .toEqual({ Status_Maintenance: 'Dimension:Dropdown' });
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('reads the rules from `value`, not from `Rules`', async () => {
    // docs/architecture/tm1-rest-quirks.md, "Reading rules": `GET Cubes('<n>')/Rules` answers
    // `{ value: "<text>" }`. A reader that expects `Rules` would silently get
    // an empty map.
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        Rules: "['A'] = S: 'static:x';", value: "['B'] = S: 'static:y';",
      }) });
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({ B: 'static:y' });
  });

  it('treats 204 as "control cube without rules", not as an error', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 204, body: '' });
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({});
    expect(logCubeViewer).not.toHaveBeenCalled();
  });

  it('does not even ask when there is no control cube', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{"error":{}}' });
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({});
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT remember a 5xx — a hiccup must not cost the session', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 503, body: 'busy' });
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({});
    expect(logCubeViewer).toHaveBeenCalled();

    apiRequest.mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
      value: "['A'] = S: 'static:x';",
    }) });
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({ A: 'static:x' });
  });

  it('catches a thrown exception — this must never cost the view', async () => {
    apiRequest.mockRejectedValue(new Error('network'));
    expect(await fetchRulePicklists(cfg, 'Plan')).toEqual({});
  });
});

describe('fetchCellPicklist — EXACTLY one cell', () => {
  const dims = ['Konto', 'Mass', 'Jahr'];
  const coords = ['K1', 'Txt', '2026'];

  it('asks for exactly one cell and returns the raw definition', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({
        Cells: [{ Value: 'static:A:B' }],
      }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:A:B');

    const mdx = JSON.parse(apiRequest.mock.calls[1][2] as string).MDX as string;
    // The proof that no range is ever produced here: ONE tuple per axis.
    expect(mdx).toContain('{[Konto].[Konto].[K1]} ON 0');
    expect(mdx).toContain('{[Mass].[Mass].[Txt]} ON 1');
    expect(mdx).toContain('WHERE ([Jahr].[Jahr].[2026],[}PickList].[}PickList].[Value])');
  });

  it('remembers the result per coordinate', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({
        Cells: [{ Value: 'static:A' }],
      }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:A');
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:A');
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('returns null for an empty cell — null means "no list", not "empty list"', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({ Cells: [{ Value: '' }] }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBeNull();
  });

  it('returns null on a server error and does not remember it', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"code":"501"}}' });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBeNull();

    apiRequest.mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({
      Cells: [{ Value: 'static:A' }],
    }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:A');
  });

  it('catches a thrown exception', async () => {
    apiRequest.mockRejectedValue(new Error('network'));
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBeNull();
  });

  it('does not ask when the coordinate does not determine the cell unambiguously', async () => {
    expect(await fetchCellPicklist(cfg, 'Plan', dims, ['K1'])).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('forgets the cell answer on refresh — it depends on cell values', async () => {
    apiRequest
      .mockResolvedValueOnce(CUBE_THERE)
      .mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({
        Cells: [{ Value: 'static:alt' }],
      }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:alt');

    invalidatePicklistResolutions('https://s:1/api/v1');
    apiRequest.mockResolvedValueOnce({ statusCode: 201, body: JSON.stringify({
      Cells: [{ Value: 'static:neu' }],
    }) });
    expect(await fetchCellPicklist(cfg, 'Plan', dims, coords)).toBe('static:neu');
  });
});

describe('fetchElementPicklists', () => {
  it('skips dimensions without a Picklist attribute', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({
      value: [{ Name: 'Caption', Type: 'String' }],
    }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    expect(apiRequest).toHaveBeenCalledTimes(1); // no second call
  });

  it('collects only filled values and trims them', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'Picklist', Type: 'String' }],
      }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [
          { Name: 'K1', Attributes: { Picklist: 'static:A:B  ' } },
          { Name: 'K2', Attributes: { Picklist: '' } },
          { Name: 'K3', Attributes: {} },
        ],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto']))
      .toEqual({ Konto: { K1: 'static:A:B' } });
  });

  it('follows the @odata.nextLink of the element list — page 2 counts just the same', async () => {
    // Element lists are paged on the server side (`@odata.nextLink`, see the
    // comment on `resolveNames`). Whoever takes only `.value` of the first page
    // silently loses ALL further attribute picklists for every dimension beyond
    // one page size — without an error, without a hint.
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
        '@odata.nextLink': "Dimensions('Konto')/Hierarchies('Konto')/Elements?$select=Name,Attributes&$skip=1",
      }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K2', Attributes: { Picklist: 'static:B' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto']))
      .toEqual({ Konto: { K1: 'static:A', K2: 'static:B' } });
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('does NOT cache when a FOLLOW-UP page fails — better no entry than half a one', async () => {
    // `fetchAllPages` with `label` throws on a broken follow-up page instead of
    // returning the too-short excerpt. The catch outside turns that into
    // "no entry" — and remembers nothing, so that the next request sees the
    // complete list.
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
        '@odata.nextLink': "Dimensions('Konto')/Hierarchies('Konto')/Elements?$skip=1",
      }) })
      .mockResolvedValueOnce({ statusCode: 503, body: '{}' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});

    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
  });

  it('never uses $filter on the complex type', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'Picklist', Type: 'String' }],
      }) })
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[]}' });
    await fetchElementPicklists(cfg, ['Konto']);
    for (const call of apiRequest.mock.calls) {
      expect(String(call[1])).not.toContain('$filter');
    }
  });

  it('swallows errors and returns an empty map', async () => {
    apiRequest.mockResolvedValue({ statusCode: 500, body: '' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
  });

  it('catches a thrown exception and returns an empty map', async () => {
    apiRequest.mockRejectedValue(new Error('network'));
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
  });

  it('queries the same dimension only ONCE (Task 7b: cache)', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
    expect(apiRequest).toHaveBeenCalledTimes(2); // Attributes + elements, exactly once
  });

  it('also remembers "this dimension has no Picklist attribute"', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"Caption"}]}' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('remembers a 404 of the attribute list — the dimension does not exist like that', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{}' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('does NOT remember a 5xx and says so on the channel', async () => {
    apiRequest.mockResolvedValueOnce({ statusCode: 500, body: '{}' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    const note = (logCubeViewer as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(note).toContain('500');
    expect(note).toContain('Konto');
    // The next call asks again and sees the real result.
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('does NOT remember a 5xx of the ELEMENT list (second request, same rule)', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 503, body: '{}' });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
    expect(apiRequest).toHaveBeenCalledTimes(4);
  });

  it('does NOT cache what came out of a thrown exception', async () => {
    apiRequest.mockRejectedValueOnce(new Error('network'));
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({});
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Picklist"}]}' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'K1', Attributes: { Picklist: 'static:A' } }],
      }) });
    expect(await fetchElementPicklists(cfg, ['Konto'])).toEqual({ Konto: { K1: 'static:A' } });
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });
});

describe('Invalidation', () => {
  // `cfg` is typed as `never` (dummy config) — that is why the URL is stated
  // here once more as a value instead of being read from `cfg`.
  const SERVER = 'https://s:1/api/v1';
  it('invalidatePicklistResolutions lets a definition be resolved again', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    await resolvePicklist(cfg, 'dimension:Konten');
    await resolvePicklist(cfg, 'dimension:Konten');
    expect(apiRequest).toHaveBeenCalledTimes(1);
    invalidatePicklistResolutions(SERVER);
    await resolvePicklist(cfg, 'dimension:Konten');
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('invalidatePicklistResolutions leaves the cube existence in place', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    invalidatePicklistResolutions(SERVER);
    expect(await hasPicklistCube(cfg, 'Plan')).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('invalidatePicklistResolutions does not touch a DIFFERENT server', async () => {
    const other = { ...(cfg as object), serverUrl: 'https://andere:1/api/v1' } as never;
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    await resolvePicklist(other, 'dimension:Konten');
    invalidatePicklistResolutions(SERVER);
    await resolvePicklist(other, 'dimension:Konten');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('disposePicklistCachesForServer throws away EVERY cache of this server', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    await hasPicklistCube(cfg, 'Plan');
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"Caption"}]}' });
    await fetchElementPicklists(cfg, ['Konto']);
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    await resolvePicklist(cfg, 'dimension:Konten');
    const before = apiRequest.mock.calls.length;

    disposePicklistCachesForServer(SERVER);

    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"Name":"}PickList_Plan"}' });
    await hasPicklistCube(cfg, 'Plan');
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"Caption"}]}' });
    await fetchElementPicklists(cfg, ['Konto']);
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    await resolvePicklist(cfg, 'dimension:Konten');
    // All three ask again — the cache is empty, not just partially.
    expect(apiRequest.mock.calls.length).toBe(before + 3);
  });
});

describe('resolvePicklist', () => {
  it('resolves static without a server request', async () => {
    expect(await resolvePicklist(cfg, 'static:A:B:C')).toEqual(['A', 'B', 'C']);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('resolves dimension via the default hierarchy', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: JSON.stringify({
      value: [{ Name: 'L1' }, { Name: 'LC' }],
    }) });
    expect(await resolvePicklist(cfg, 'dimension:Konten')).toEqual(['L1', 'LC']);
    expect(String(apiRequest.mock.calls[0][1])).toContain("Hierarchies('Konten')");
  });

  it('takes the named hierarchy for dimension:Dim:Hier', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"H_alt"}]}' });
    await resolvePicklist(cfg, 'dimension:Konten:Alt');
    expect(String(apiRequest.mock.calls[0][1])).toContain("Hierarchies('Alt')");
  });

  it('takes the public Subset before the private one', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    expect(await resolvePicklist(cfg, 'subset:Konten:Top')).toEqual(['L1']);
    expect(String(apiRequest.mock.calls[0][1])).toContain('/Subsets(');
    expect(String(apiRequest.mock.calls[0][1])).not.toContain('PrivateSubsets');
  });

  it('falls back to the private Subset when it does not exist publicly in ANY hierarchy', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 404, body: '{}' })  // public, default hierarchy
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Konten"}]}' }) // hierarchy list: only the one
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"P1"}]}' }); // private, default hierarchy
    expect(await resolvePicklist(cfg, 'subset:Konten:Top')).toEqual(['P1']);
    expect(String(apiRequest.mock.calls[2][1])).toContain('PrivateSubsets');
  });

  it('finds a public Subset that exists ONLY in an alternative hierarchy', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 404, body: '{}' })  // public, default hierarchy 'Konten' — not there
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"Konten"},{"Name":"Alt"}]}' }) // hierarchy list
      .mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"A1"}]}' }); // public, 'Alt' — there
    expect(await resolvePicklist(cfg, 'subset:Konten:Top')).toEqual(['A1']);
    expect(String(apiRequest.mock.calls[2][1])).toContain("Hierarchies('Alt')");
    expect(String(apiRequest.mock.calls[2][1])).toContain('/Subsets(');
    expect(String(apiRequest.mock.calls[2][1])).not.toContain('PrivateSubsets');
    // Found on the first public alternative — no further,
    // private attempt needed.
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });

  it('takes only the named hierarchy for subset:Dim:Hier:Subset, no fallback', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{}' });
    expect(await resolvePicklist(cfg, 'subset:Konten:Alt:Top')).toBeNull();
    // Only two attempts in THE ONE named hierarchy (public, then
    // private) — no hierarchy list, no other hierarchies.
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(String(apiRequest.mock.calls[0][1])).toContain("Hierarchies('Alt')");
    expect(String(apiRequest.mock.calls[1][1])).toContain("Hierarchies('Alt')");
    expect(String(apiRequest.mock.calls[1][1])).toContain('PrivateSubsets');
  });

  it('returns null when the reference points into nothing', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{}' });
    expect(await resolvePicklist(cfg, 'dimension:gibt_es_nicht')).toBeNull();
  });

  it('returns null for an unreadable definition', async () => {
    expect(await resolvePicklist(cfg, 'unsinn:a:b')).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('queries the same definition only once', async () => {
    apiRequest.mockResolvedValue({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    await resolvePicklist(cfg, 'dimension:Konten');
    await resolvePicklist(cfg, 'dimension:Konten');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('catches a thrown exception, returns null and does NOT cache', async () => {
    apiRequest.mockRejectedValueOnce(new Error('network'));
    expect(await resolvePicklist(cfg, 'dimension:Ausreisser')).toBeNull();
    // A second call after the outlier asks again (no cache hit
    // on a thrown null) and returns the real result.
    apiRequest.mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    expect(await resolvePicklist(cfg, 'dimension:Ausreisser')).toEqual(['L1']);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('caches a null hit derived from a real 404 response', async () => {
    apiRequest.mockResolvedValue({ statusCode: 404, body: '{}' });
    await resolvePicklist(cfg, 'dimension:Tot');
    await resolvePicklist(cfg, 'dimension:Tot');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('follows @odata.nextLink when resolving a dimension', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'L1' }],
        '@odata.nextLink': "Dimensions('Konten')/Hierarchies('Konten')/Elements?$select=Name&$skip=1",
      }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'L2' }] }) });
    expect(await resolvePicklist(cfg, 'dimension:Konten')).toEqual(['L1', 'L2']);
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('returns null and does NOT cache when a follow-up page fails', async () => {
    apiRequest
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        value: [{ Name: 'L1' }],
        '@odata.nextLink': "Dimensions('Konten')/Hierarchies('Konten')/Elements?$select=Name&$skip=1",
      }) })
      .mockResolvedValueOnce({ statusCode: 500, body: '{}' }); // page 2 fails
    // An incomplete list (only L1) would be worse than none at all:
    // it would leave out values that TM1 would accept. Hence null.
    expect(await resolvePicklist(cfg, 'dimension:Konten')).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(2);

    // Not cached: the next call asks again and returns the
    // real result as soon as the server answers cleanly again.
    apiRequest.mockResolvedValueOnce({ statusCode: 200, body: '{"value":[{"Name":"L1"}]}' });
    expect(await resolvePicklist(cfg, 'dimension:Konten')).toEqual(['L1']);
    expect(apiRequest).toHaveBeenCalledTimes(3);
  });
});
