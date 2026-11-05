import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSubset, listSubsetElementNames, clearSubsetElements } from '../../tm1Rest/subsetApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, type FakeTm1 } from '../__mocks__/fakeTm1Server';

/**
 * A 2xx whose body is not the expected JSON (proxy login page, gateway
 * banner) says nothing about the subset. It must not read as "static" or as
 * a complete element list — both feed the overwrite path.
 */

const html = (res: import('http').ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body>Please sign in</body></html>');
};

describe('subsetApi — 2xx with an unusable body', () => {
  let fake: FakeTm1 | undefined;
  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => { _clearAllSessionsForTest(); await fake?.close(); fake = undefined; });

  it('getSubset: HTML 200 is not a static subset', async () => {
    fake = await startFakeTm1((_req, res) => html(res));
    const out = await getSubset(fakeConfig(fake.url), 'D', 'H', 'S', false);
    expect(out.ok).toBe(false);
  });

  it('listSubsetElementNames: HTML 200 on the first page is not complete', async () => {
    fake = await startFakeTm1((_req, res) => html(res));
    const out = await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'S', false);
    expect(out.complete).toBe(false);
  });

  it('listSubsetElementNames: HTML 200 on a later page is not complete', async () => {
    fake = await startFakeTm1((req, res) => {
      if ((req.url ?? '').includes('page2')) { html(res); return; }
      jsonResponse(res, 200, { value: [{ Name: 'A' }], '@odata.nextLink': `${fake!.url}/api/v1/page2` });
    });
    const out = await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'S', false);
    expect(out).toMatchObject({ elements: ['A'], complete: false });
  });

  it('clearSubsetElements: HTML 200 is not "already empty"', async () => {
    fake = await startFakeTm1((_req, res) => html(res));
    await expect(clearSubsetElements(fakeConfig(fake.url), 'D', 'H', 'S', false)).rejects.toThrow(/could not be read/);
  });
});
