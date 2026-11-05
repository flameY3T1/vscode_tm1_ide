import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { request } from '../../../tm1Rest/transport/http';
import { _clearAllSessionsForTest } from '../../../tm1Rest/transport/session';
import { _gateActiveForTest, _resetRequestGateForTest } from '../../../tm1Rest/transport/requestGate';
import { startFakeTm1, fakeConfig, type FakeTm1 } from '../../__mocks__/fakeTm1Server';

/**
 * A server that announces a Content-Length, sends part of an uncompressed
 * body and then drops the connection. The compressed branch rejects through
 * `res.on('error')`; the identity branch must settle too and free its slot.
 */

let fake: FakeTm1 | undefined;
beforeEach(() => { _clearAllSessionsForTest(); _resetRequestGateForTest(4); });
afterEach(async () => { fake?.server.closeAllConnections(); await fake?.close(); fake = undefined; });

describe('transport — truncated identity body', () => {
  it('rejects and frees the request slot when the socket closes mid-body', async () => {
    fake = await startFakeTm1((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
      res.write('{"value":[');
      setTimeout(() => res.socket?.destroy(), 30);
    });
    const host = new URL(fake.url).host;
    const p = request('GET', `${fake.url}/api/v1/Cubes`, fakeConfig(fake.url), undefined, 150);
    const outcome = await Promise.race([
      p.then(() => 'resolved', () => 'rejected'),
      new Promise(r => setTimeout(() => r('pending'), 600)),
    ]);
    expect(outcome).toBe('rejected');
    expect(_gateActiveForTest(host)).toBe(0);
  });
});
