/**
 * The undo pre-check reads current cell values via `POST ExecuteMDX` — that
 * creates one cellset per batch on the server. Follow-up review 2026-09-23 F5: the
 * ID was discarded, no DELETE followed, not even on a later abort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../../tm1Rest/client', () => ({ apiRequest }));

import { readCurrent, type CellJob } from '../../commands/transactionLog';

const cfg = { serverUrl: 'http://tm1' } as never;
const job = (): CellJob => ({ cube: 'C', tuple: ['a', 'b'], dims: ['D1', 'D2'], entries: [] });

beforeEach(() => { apiRequest.mockReset(); });

describe('readCurrent', () => {
  it('reads the value and deletes the cellset it created', async () => {
    apiRequest.mockImplementation(async (method: string) => (method === 'POST'
      ? { statusCode: 201, body: JSON.stringify({ ID: 'cs-1', Cells: [{ Ordinal: 0, Value: 42 }] }) }
      : { statusCode: 204, body: '' }));
    const j = job();
    await readCurrent(cfg, 'C', [j]);
    expect(j.current).toBe(42);
    expect(apiRequest.mock.calls.map(c => `${c[0]} ${c[1]}`)).toEqual([
      'POST ExecuteMDX?$expand=Cells($select=Ordinal,Value)',
      "DELETE Cellsets('cs-1')",
    ]);
  });

  it('keeps the read value when the DELETE fails', async () => {
    apiRequest.mockImplementation(async (method: string) => {
      if (method === 'DELETE') { throw new Error('socket hang up'); }
      return { statusCode: 201, body: JSON.stringify({ ID: 'cs-2', Cells: [{ Ordinal: 0, Value: 'x' }] }) };
    });
    const j = job();
    await readCurrent(cfg, 'C', [j]);
    expect(j.current).toBe('x');
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it('sends no DELETE when no cellset was created', async () => {
    apiRequest.mockResolvedValue({ statusCode: 400, body: 'bad MDX' });
    const j = job();
    await readCurrent(cfg, 'C', [j]);
    expect(j.skip).toContain('HTTP 400');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
