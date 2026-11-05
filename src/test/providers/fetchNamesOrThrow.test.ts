import { describe, it, expect, afterEach } from 'vitest';
import { fetchNames, fetchNamesOrThrow, invalidateCache } from '../../providers/fetchNames';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, type FakeTm1 } from '../__mocks__/fakeTm1Server';

/**
 * Commands (Go to Object, Bedrock) need to tell "the server has none" from
 * "the server did not answer"; completion and lint keep the quiet `[]`.
 */
let fake: FakeTm1 | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
  invalidateCache();
  _clearAllSessionsForTest();
});

describe('fetchNamesOrThrow', () => {
  it('throws on a server error, while fetchNames still yields []', async () => {
    fake = await startFakeTm1((_req, res) => { res.statusCode = 500; res.end(); });
    const cfg = fakeConfig(fake.url);
    await expect(fetchNamesOrThrow('Processes', cfg)).rejects.toThrow();
    expect(await fetchNames('Processes', cfg)).toEqual([]);
  });
});
