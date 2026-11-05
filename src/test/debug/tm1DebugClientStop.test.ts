import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../../tm1Rest/threadApi', () => ({ listThreads: vi.fn(), cancelThread: vi.fn() }));

import { apiRequest } from '../../tm1Rest/client';
import { listThreads, cancelThread } from '../../tm1Rest/threadApi';
import { Tm1DebugClient } from '../../debug/tm1DebugClient';

/**
 * Stopping a debug run cancels its thread (DELETE on the context is a no-op,
 * tm1-rest-quirks.md). It used to cancel EVERY thread of that process in
 * Wait:DBG or Run — a second debug session of the same process, a colleague's
 * debug session, or a regular run. Live 11.8 (2026-11-03, throwaway process,
 * two logins): `ProcessDebugContexts('<id>')/Thread` names exactly the
 * context's own thread, and cancelling only that one leaves the other context
 * Paused. The Wait:DBG threads carry no Session, so the session cannot tell.
 */
const CFG = { serverUrl: 'http://srv:1', username: 'u', password: 'p', authType: 'Basic' } as never;
const PROC = 'zz_proc';
const threads = [
  { ID: 10080, State: 'Wait:DBG', ObjectName: PROC, Name: 'Admin' },
  { ID: 14264, State: 'Wait:DBG', ObjectName: PROC, Name: 'Admin' },
  { ID: 777, State: 'Run', ObjectName: PROC, Name: 'Colleague' },
];

function answer(threadNav: { statusCode: number; body: string }) {
  vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) =>
    (path.includes('/Thread') ? threadNav : { statusCode: 204, body: '' }) as never);
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(cancelThread).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(listThreads).mockReset().mockResolvedValue(threads as never);
});

describe('Tm1DebugClient.stop cancels only its own thread', () => {
  it("cancels the context's own thread and nothing else", async () => {
    answer({ statusCode: 200, body: JSON.stringify({ ID: 10080, State: 'Wait:DBG' }) });
    await new Tm1DebugClient(CFG).stop('ctx2', PROC);
    expect(vi.mocked(cancelThread).mock.calls.map(c => c[1])).toEqual([10080]);
  });

  it('without the Thread navigation: cancels nothing while two debug threads are ambiguous', async () => {
    answer({ statusCode: 400, body: '{"error":{"code":"278"}}' });
    await new Tm1DebugClient(CFG).stop('ctx2', PROC);
    expect(cancelThread).not.toHaveBeenCalled();
  });

  it('without the Thread navigation: cancels the single debug thread, never a regular run', async () => {
    answer({ statusCode: 400, body: '' });
    vi.mocked(listThreads).mockResolvedValue([threads[0], threads[2]] as never);
    await new Tm1DebugClient(CFG).stop('ctx2', PROC);
    expect(vi.mocked(cancelThread).mock.calls.map(c => c[1])).toEqual([10080]);
  });
});
