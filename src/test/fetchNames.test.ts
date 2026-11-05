import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchNames, invalidateCache, warmCache } from '../providers/fetchNames';
import { _clearAllSessionsForTest } from '../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, type FakeTm1 } from './__mocks__/fakeTm1Server';

describe('fetchNames cache', () => {
  let fake: FakeTm1;

  beforeEach(() => {
    _clearAllSessionsForTest();
    invalidateCache();
  });
  afterEach(async () => {
    _clearAllSessionsForTest();
    invalidateCache();
    await fake?.close();
  });

  it('returns names parsed from value array', async () => {
    fake = await startFakeTm1((_req, res) => {
      jsonResponse(res, 200, { value: [{ Name: 'Sales' }, { Name: 'COGS' }] });
    });
    const names = await fetchNames('Cubes', fakeConfig(fake.url));
    expect(names).toEqual(['Sales', 'COGS']);
  });

  it('caches result and serves second call without re-fetching', async () => {
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [{ Name: 'A' }] });
    });
    const cfg = fakeConfig(fake.url);
    await fetchNames('Cubes', cfg);
    await fetchNames('Cubes', cfg);
    expect(hits).toBe(1);
  });

  it('an impersonated view gets its OWN cache entry', async () => {
    // Otherwise the impersonated user would see the administrator's name list
    // for five minutes — and, conversely, after ending it, would not see their own list.
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [{ Name: 'AdminOnlyCube' }] });
    });
    const cfg = fakeConfig(fake.url);
    await fetchNames('Cubes', cfg);
    await fetchNames('Cubes', { ...cfg, impersonate: 'reader' });
    expect(hits).toBe(2);
  });

  it('the server identifier still comes FIRST — invalidateCache finds it', async () => {
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [{ Name: 'A' }] });
    });
    const cfg = { ...fakeConfig(fake.url), impersonate: 'reader' };
    await fetchNames('Cubes', cfg);
    invalidateCache('Cubes', fake.url);
    await fetchNames('Cubes', cfg);
    expect(hits).toBe(2);
  });

  it('returns [] on non-200 status', async () => {
    fake = await startFakeTm1((_req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    const names = await fetchNames('Cubes', fakeConfig(fake.url));
    expect(names).toEqual([]);
  });

  it('returns [] when request throws (ECONNREFUSED)', async () => {
    const names = await fetchNames('Cubes', fakeConfig('http://127.0.0.1:1'));
    expect(names).toEqual([]);
  });

  it('Hierarchies endpoint flattens dim → hierarchy names', async () => {
    fake = await startFakeTm1((_req, res) => {
      jsonResponse(res, 200, {
        value: [
          { Name: 'Sales', Hierarchies: [{ Name: 'Sales' }, { Name: 'ByRegion' }] },
          { Name: 'Time', Hierarchies: [{ Name: 'Time' }] },
        ],
      });
    });
    const names = await fetchNames('Hierarchies', fakeConfig(fake.url));
    expect(names).toEqual(['Sales', 'ByRegion', 'Time']);
  });

  it('invalidateCache(endpoint) only clears matching endpoint', async () => {
    let hits = 0;
    fake = await startFakeTm1((req, res) => {
      hits++;
      const name = (req.url ?? '').startsWith('/api/v1/Cubes') ? 'C' : 'D';
      jsonResponse(res, 200, { value: [{ Name: name }] });
    });
    const cfg = fakeConfig(fake.url);
    await fetchNames('Cubes', cfg);
    await fetchNames('Dimensions', cfg);
    invalidateCache('Cubes');
    await fetchNames('Cubes', cfg);
    await fetchNames('Dimensions', cfg);
    expect(hits).toBe(3);
  });

  it('invalidateCache(undefined) clears everything', async () => {
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [{ Name: 'X' }] });
    });
    const cfg = fakeConfig(fake.url);
    await fetchNames('Cubes', cfg);
    await fetchNames('Dimensions', cfg);
    invalidateCache();
    await fetchNames('Cubes', cfg);
    await fetchNames('Dimensions', cfg);
    expect(hits).toBe(4);
  });

  it('invalidateCache(undefined, serverUrl) clears only that server', async () => {
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [{ Name: 'X' }] });
    });
    const cfg = fakeConfig(fake.url);
    await fetchNames('Cubes', cfg);
    invalidateCache(undefined, fake.url);
    await fetchNames('Cubes', cfg);
    expect(hits).toBe(2);
  });

  it('warmCache fires five endpoint requests without awaiting', async () => {
    let hits = 0;
    fake = await startFakeTm1((_req, res) => {
      hits++;
      jsonResponse(res, 200, { value: [] });
    });
    warmCache(fakeConfig(fake.url));
    await new Promise((r) => setTimeout(r, 100));
    expect(hits).toBe(5);
  });
});
