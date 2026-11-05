import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCubes,
  getCubeDims,
  getDimElements,
  clearSessionElements,
  clearSchemaCacheForServer,
  _clearAllForTest,
  _elemCacheSizeForTest,
  ELEM_CACHE_MAX,
} from '../mdx/mdxSchemaCache';

const cfg = { serverUrl: 'http://srv:8080', username: 'u', password: 'p' } as any;

function mockApi(responses: Record<string, { statusCode: number; body: string }>) {
  return vi.fn().mockImplementation((_m: string, path: string) =>
    // A fresh object per call: `parseBody` releases `body`, and a shared
    // response would read as '' (a parse failure) the second time.
    Promise.resolve({ ...(responses[path] ?? { statusCode: 404, body: '' }) }),
  );
}

describe('mdxSchemaCache', () => {
  beforeEach(() => { _clearAllForTest(); });

  it('getCubes returns server cube names', async () => {
    const api = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A' }, { Name: 'B' }] }) },
    });
    const names = await getCubes(cfg, api);
    expect(names).toEqual(['A', 'B']);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('getCubes caches within TTL', async () => {
    const api = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A' }] }) },
    });
    await getCubes(cfg, api);
    await getCubes(cfg, api);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('keeps two v12 databases behind one gateway apart', async () => {
    const api = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A' }] }) },
    });
    const v12 = (database: string) => ({
      ...cfg, version: 'v12', authType: 'v12-basic',
      v12: { instance: 'tm1', database, authMode: 'basic-s2s', tm1User: 'Admin' },
    }) as unknown as typeof cfg;
    await getCubes(v12('sales'), api);
    await getCubes(v12('finance'), api);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('getCubeDims fetches the cube-specific dimension list', async () => {
    const api = mockApi({
      "Cubes('Sales')/Dimensions?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Month' }, { Name: 'Product' }] }),
      },
    });
    const dims = await getCubeDims('Sales', cfg, api);
    expect(dims).toEqual(['Month', 'Product']);
  });

  it('getDimElements returns lowercased set', async () => {
    const api = mockApi({
      "Dimensions('Month')/Hierarchies('Month')/Elements?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Jan' }, { Name: 'Feb' }] }),
      },
    });
    const set = await getDimElements('Month', cfg, api);
    expect(set!.has('jan')).toBe(true);
    expect(set!.has('feb')).toBe(true);
    expect(set!.has('dec')).toBe(false);
  });

  it('getDimElements follows @odata.nextLink verbatim across pages (v12-safe)', async () => {
    const p1 = "Dimensions('Big')/Hierarchies('Big')/Elements?$select=Name";
    // v12 nextLink carries a Databases('db') segment AFTER /api/v1/. It must be
    // forwarded to the fetcher verbatim (apiRequest passes absolute URLs through
    // unchanged). Slicing off /api/v1/ would leave Databases('db')/… which gets
    // base-prepended a second time on v12 → duplicated segment → 404 on page 2.
    const nextAbs = "http://srv:8080/tm1/api/v1/Databases('db')/Dimensions('Big')/Hierarchies('Big')/Elements?$select=Name&$skip=1";
    const api = mockApi({
      [p1]: { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'PageOne' }], '@odata.nextLink': nextAbs }) },
      [nextAbs]: { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'PageTwo' }] }) },
    });
    const set = await getDimElements('Big', cfg, api);
    expect(set!.has('pageone')).toBe(true);
    expect(set!.has('pagetwo')).toBe(true); // would be missing if only page 1 were fetched
    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenNthCalledWith(2, 'GET', nextAbs); // passed through, not mangled
  });

  it('getDimElements caches per dim', async () => {
    const api = mockApi({
      "Dimensions('Month')/Hierarchies('Month')/Elements?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Jan' }] }),
      },
    });
    await getDimElements('Month', cfg, api);
    await getDimElements('Month', cfg, api);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('a late answer from before a clear does not land in the fresh cache', async () => {
    let release!: () => void;
    const old = vi.fn().mockImplementation(() => new Promise((r) => {
      release = () => r({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Old' }] }) });
    }));
    const pending = getCubes(cfg, old);
    clearSchemaCacheForServer(cfg.serverUrl);
    release();
    await pending;
    const fresh = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'New' }] }) },
    });
    expect(await getCubes(cfg, fresh)).toEqual(['New']);
  });

  it('clearSchemaCacheForServer refetches the cube list for that server only', async () => {
    const other = { ...cfg, serverUrl: 'http://other:8080' };
    const api = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A' }] }) },
    });
    await getCubes(cfg, api);
    await getCubes(other, api);
    clearSchemaCacheForServer(cfg.serverUrl);
    await getCubes(cfg, api);
    await getCubes(other, api);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('clearSessionElements drops the element cache', async () => {
    const api = mockApi({
      "Dimensions('Month')/Hierarchies('Month')/Elements?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Jan' }] }),
      },
    });
    await getDimElements('Month', cfg, api);
    clearSessionElements();
    await getDimElements('Month', cfg, api);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('clearSessionElements with server prefix only clears that server', async () => {
    const cfgA = { serverUrl: 'http://a', username: 'u' } as any;
    const cfgB = { serverUrl: 'http://b', username: 'u' } as any;
    const api = mockApi({
      "Dimensions('M')/Hierarchies('M')/Elements?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'Jan' }] }),
      },
    });
    await getDimElements('M', cfgA, api);
    await getDimElements('M', cfgB, api);
    expect(api).toHaveBeenCalledTimes(2);
    clearSessionElements('http://a');
    // A was cleared → refetch; B survived → cache hit.
    await getDimElements('M', cfgA, api);
    await getDimElements('M', cfgB, api);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('getDimElements returns empty set on HTTP error (dim not found)', async () => {
    const api = mockApi({}); // any path → 404
    const set = await getDimElements('Nope', cfg, api);
    expect(set?.size).toBe(0);
  });

  it('a server error yields null and is not cached — the next call retries', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ statusCode: 500, body: '' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Jan' }] }) });
    expect(await getDimElements('Month', cfg, api)).toBeNull();
    expect(await getDimElements('Month', cfg, api)).toEqual(new Set(['jan']));
  });

  it('a page-2 failure yields null instead of a partial list', async () => {
    const api = vi.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A' }], '@odata.nextLink': 'next' }) })
      .mockResolvedValueOnce({ statusCode: 503, body: '' });
    expect(await getDimElements('Big', cfg, api)).toBeNull();
  });

  it('getCubes does not cache an empty list from an unreachable server', async () => {
    const api = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Sales' }] }) });
    expect(await getCubes(cfg, api)).toEqual([]);
    expect(await getCubes(cfg, api)).toEqual(['Sales']);
  });

  it('getCubes returns [] on server unreachable (API throws)', async () => {
    const api = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const names = await getCubes(cfg, api);
    expect(names).toEqual([]);
  });

  it('different serverUrl → separate cache entries', async () => {
    const cfgA = { serverUrl: 'http://a', username: 'u' } as any;
    const cfgB = { serverUrl: 'http://b', username: 'u' } as any;
    const api = mockApi({
      'Cubes?$select=Name': { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'X' }] }) },
    });
    await getCubes(cfgA, api);
    await getCubes(cfgB, api);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("cube name with apostrophe is escaped via doubled quotes", async () => {
    const api = mockApi({
      // encodeURIComponent("O''Brien") leaves apostrophes unchanged → path uses doubled apostrophes
      "Cubes('O''Brien')/Dimensions?$select=Name": {
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: 'D' }] }),
      },
    });
    const dims = await getCubeDims("O'Brien", cfg, api);
    expect(dims).toEqual(['D']);
  });

  // Any-dim mock: returns a single element per dim, 200 for any Elements path.
  function anyDimApi() {
    return vi.fn().mockImplementation((_m: string, path: string) => {
      const match = /Dimensions\('([^']+)'\)/.exec(path);
      const name = match ? match[1] : 'X';
      return Promise.resolve({
        statusCode: 200,
        body: JSON.stringify({ value: [{ Name: `E_${name}` }] }),
      });
    });
  }

  it('elemCache stays bounded at ELEM_CACHE_MAX distinct dims', async () => {
    const api = anyDimApi();
    for (let i = 0; i < ELEM_CACHE_MAX + 10; i++) {
      await getDimElements(`Dim${i}`, cfg, api);
    }
    expect(_elemCacheSizeForTest()).toBeLessThanOrEqual(ELEM_CACHE_MAX);
  });

  it('LRU: an accessed dim survives overflow; a non-accessed one is evicted', async () => {
    const api = anyDimApi();
    // Fill cache exactly to cap: Dim0 .. Dim(cap-1).
    for (let i = 0; i < ELEM_CACHE_MAX; i++) {
      await getDimElements(`Dim${i}`, cfg, api);
    }
    expect(api).toHaveBeenCalledTimes(ELEM_CACHE_MAX);
    // Touch Dim0 → moves it to most-recently-used (should NOT refetch).
    await getDimElements('Dim0', cfg, api);
    expect(api).toHaveBeenCalledTimes(ELEM_CACHE_MAX); // still a hit
    // Insert one new dim → overflow evicts the oldest, which is now Dim1 (Dim0 was touched).
    await getDimElements('DimNew', cfg, api);
    expect(api).toHaveBeenCalledTimes(ELEM_CACHE_MAX + 1);
    // Dim0 still resident → hit, no refetch.
    await getDimElements('Dim0', cfg, api);
    expect(api).toHaveBeenCalledTimes(ELEM_CACHE_MAX + 1);
    // Dim1 was evicted → miss, refetch.
    await getDimElements('Dim1', cfg, api);
    expect(api).toHaveBeenCalledTimes(ELEM_CACHE_MAX + 2);
  });

  it('cache HIT returns the same Set instance without refetching', async () => {
    const api = anyDimApi();
    const first = await getDimElements('Month', cfg, api);
    const second = await getDimElements('Month', cfg, api);
    expect(second).toBe(first);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
