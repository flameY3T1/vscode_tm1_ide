import { describe, it, expect, vi } from 'vitest';

/**
 * Regression: `pollForStop` polled forever once the server went away — every
 * round a full timeout with a `pollError`, never a status. It now ends the
 * session after MAX_UNREACHABLE_POLLS such rounds and tells TM1 to stop.
 */

vi.mock('../serverState/state', () => ({
  getServerConfig: () => undefined,
  getConnectedIds: () => [],
  getConnectedIdsRestored: async () => [],
}));
vi.mock('../tm1Rest/client', () => ({ getConfig: () => ({}) }));
vi.mock('../tm1Rest/logsApi', () => ({ fetchProcessMessageLog: vi.fn() }));

import { Tm1DebugAdapter } from '../debug/tm1DebugAdapter';

describe('Tm1DebugAdapter — server gone while running', () => {
  it('terminates after repeated unreachable polls and stops the debug context', async () => {
    const client = {
      continue: vi.fn().mockResolvedValue(undefined),
      pollUntilPaused: vi.fn().mockResolvedValue({ id: 'dbg1', status: 'Running', timedOut: true, pollError: 'ECONNREFUSED' }),
      stop: vi.fn().mockResolvedValue(undefined),
      isEnded: () => false,
    };
    const adapter = new Tm1DebugAdapter();
    Object.assign(adapter as any, { client, debugId: 'dbg1', processName: 'P' });
    const messages: any[] = [];
    adapter.onDidSendMessage(m => messages.push(m));

    adapter.handleMessage({ type: 'request', seq: 1, command: 'continue', arguments: {} });
    await vi.waitFor(() => expect(messages.some(m => m.event === 'terminated')).toBe(true));

    expect(client.pollUntilPaused).toHaveBeenCalledTimes(2);
    expect(client.stop).toHaveBeenCalledWith('dbg1', 'P');
  });
});
