import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PawGatewayError } from '../../tm1Rest/pawGatewayUrl';

// The first PAW list request after start can hang into the timeout; one
// retry, and only on a timeout (report 2026-11-01).
const pawTransport = vi.fn();
vi.mock('../../tm1Rest/pawGatewayApi', () => ({ listPawInstances: (...a: unknown[]) => pawTransport(...a) }));
import { listInstancesFor } from '../../providers/adminInstances';

const admin = { kind: 'paw' as const, serverUrl: 'https://paw.invalid', rejectUnauthorized: true };

describe('PAW database list retries once on a timeout', () => {
  beforeEach(() => { pawTransport.mockReset(); });

  it('timeout, then an answer: the answer', async () => {
    pawTransport
      .mockRejectedValueOnce(new PawGatewayError('timed out', 'timeout'))
      .mockResolvedValueOnce([{ name: 'db1', acceptingClients: true }]);
    const list = await listInstancesFor(admin);
    expect(list.map(i => i.name)).toEqual(['db1']);
    expect(pawTransport).toHaveBeenCalledTimes(2);
  });

  it('two timeouts: the timeout stands, no third try', async () => {
    pawTransport.mockRejectedValue(new PawGatewayError('timed out', 'timeout'));
    await expect(listInstancesFor(admin)).rejects.toMatchObject({ code: 'timeout' });
    expect(pawTransport).toHaveBeenCalledTimes(2);
  });

  it('any other error: no retry', async () => {
    pawTransport.mockRejectedValue(new PawGatewayError('bad json', 'response'));
    await expect(listInstancesFor(admin)).rejects.toMatchObject({ code: 'response' });
    expect(pawTransport).toHaveBeenCalledTimes(1);
  });
});
