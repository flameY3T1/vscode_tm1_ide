import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const calls: string[] = [];
let responses: { statusCode: number; body: string }[] = [];

vi.mock('../../tm1Client', () => ({
  apiRequest: vi.fn(async (_m: string, path: string) => {
    calls.push(path);
    return responses.shift() ?? { statusCode: 200, body: '{"value":[]}' };
  }),
  assertOk: (res: { statusCode: number; body: string }) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`HTTP ${res.statusCode}: ${res.body}`);
    }
  },
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));

import { fetchMessageLogEntries } from '../../commands/messageLog';

const CFG = { serverUrl: 'https://h:1/api/v1', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;
const ROW = '{"value":[{"Level":"Error","TimeStamp":"2026-08-25T06:11:33.356Z","Message":"m"}]}';

beforeEach(() => {
  calls.length = 0;
  responses = [];
});

describe('fetchMessageLogEntries — server-side level filter', () => {
  it('sends no $filter when none is given, so the plain query is unchanged', async () => {
    responses = [{ statusCode: 200, body: ROW }];
    await fetchMessageLogEntries(100, CFG);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('$filter');
    expect(calls[0]).toContain('$top=100');
  });

  it('puts the filter on the wire URL-encoded', async () => {
    responses = [{ statusCode: 200, body: ROW }];
    await fetchMessageLogEntries(200, CFG, { levelFilter: "(Level eq ibm.tm1.api.v1.LogLevel'Error')" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('$top=200');
    expect(decodeURIComponent(calls[0])).toContain("Level eq ibm.tm1.api.v1.LogLevel'Error'");
    // Spaces must not travel raw. Apostrophes may: `encodeURIComponent` leaves
    // them alone and the live 11.8 probe accepted them verbatim in the query.
    expect(calls[0]).not.toMatch(/\$filter=[^&]* /);
    expect(calls[0]).toContain('%20eq%20');
  });

  it('keeps the depth window on MATCHING rows: $top rides along with the filter', async () => {
    responses = [{ statusCode: 200, body: ROW }];
    await fetchMessageLogEntries(500, CFG, { levelFilter: "(Level eq ibm.tm1.api.v1.LogLevel'Error')" });
    expect(calls[0]).toMatch(/\$top=500/);
    expect(calls[0]).toContain('$filter');
  });

  it('retries once WITHOUT the filter when the server rejects the enum literal', async () => {
    // Live 11.8 answers a misspelled enum TYPE with HTTP 501 "functionExpr not
    // currently supported" — loud, so one unfiltered retry is safe and degrades
    // to the old shallow-window behaviour instead of an error banner.
    responses = [
      { statusCode: 501, body: '{"error":{"code":"278","message":"functionExpr not currently supported."}}' },
      { statusCode: 200, body: ROW },
    ];
    const out = await fetchMessageLogEntries(100, CFG, { levelFilter: "(Level eq some.other.ns.LogLevel'Error')" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('$filter');
    expect(calls[1]).not.toContain('$filter');
    expect(out).toHaveLength(1);
  });

  it('does not retry when there was no filter to blame', async () => {
    responses = [{ statusCode: 500, body: 'boom' }];
    await expect(fetchMessageLogEntries(100, CFG)).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it('still throws when the unfiltered retry also fails', async () => {
    responses = [
      { statusCode: 501, body: 'nope' },
      { statusCode: 500, body: 'boom' },
    ];
    await expect(
      fetchMessageLogEntries(100, CFG, { levelFilter: "(Level eq ibm.tm1.api.v1.LogLevel'Error')" }),
    ).rejects.toThrow(/500/);
    expect(calls).toHaveLength(2);
  });
});
