import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { Tm1DebugClient } from '../../debug/tm1DebugClient';

const CFG = { serverUrl: 'http://srv:1', username: 'u', password: 'p', authType: 'basic' } as any;

function odata(value: unknown[]): string {
  return JSON.stringify({ '@odata.context': '$metadata#x', value });
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});

describe('Tm1DebugClient.getCallStack', () => {
  it('parses per-frame process name from the expanded Process navigation', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: odata([
        { ID: 2, Procedure: 'Prolog', LineNumber: 7, Process: { Name: 'Sub.Process' } },
        { ID: 1, Procedure: 'Epilog', LineNumber: 3, Process: { Name: 'Main.Process' } },
      ]),
    } as any);

    const frames = await new Tm1DebugClient(CFG).getCallStack('dbg1');

    // Requests the expand variant first.
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toContain('$expand=Process($select=Name)');
    expect(frames[0]).toEqual({ id: '2', procedure: 'Prolog', lineNumber: 7, processName: 'Sub.Process' });
    expect(frames[1].processName).toBe('Main.Process');
  });

  it('falls back to a plain CallStack GET when expand is rejected (older TM1)', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"expand not supported"}}' } as any)
      .mockResolvedValueOnce({ statusCode: 200, body: odata([{ ID: 1, Procedure: 'Data', LineNumber: 9 }]) } as any);

    const frames = await new Tm1DebugClient(CFG).getCallStack('dbg1');

    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(2);
    // Second call is the plain endpoint (no query string).
    expect(vi.mocked(apiRequest).mock.calls[1][1]).not.toContain('$expand');
    expect(frames[0]).toEqual({ id: '1', procedure: 'Data', lineNumber: 9, processName: undefined });
  });

  it('returns [] on 404 without a fallback retry', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 404, body: '' } as any);
    const frames = await new Tm1DebugClient(CFG).getCallStack('gone');
    expect(frames).toEqual([]);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(1);
  });

  it('leaves processName undefined when Process is null', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200,
      body: odata([{ ID: 1, Procedure: 'Prolog', LineNumber: 1, Process: null }]),
    } as any);
    const frames = await new Tm1DebugClient(CFG).getCallStack('dbg1');
    expect(frames[0].processName).toBeUndefined();
  });
});
