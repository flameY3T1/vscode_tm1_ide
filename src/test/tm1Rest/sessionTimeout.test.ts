import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseIsoDurationMs, learnSessionTimeout } from '../../tm1Rest/sessionTimeoutApi';
import { _setSession, _getSession, sessionExpiresAt, _invalidateSession } from '../../tm1Rest/transport/session';
import { nextExpiry } from '../../commands/serverManager/sessionStatusPure';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'https://t:1/api/v1', username: 'u', password: 'p', authType: 'Basic' } as Tm1Config;

describe('parseIsoDurationMs', () => {
  it('reads the measured server value and short forms', () => {
    expect(parseIsoDurationMs('P0DT02H00M00S')).toBe(2 * 3600_000);
    expect(parseIsoDurationMs('PT20M')).toBe(20 * 60_000);
    expect(parseIsoDurationMs('P1D')).toBe(86400_000);
  });
  it('rejects anything else', () => {
    for (const bad of ['', 'P', 'PT', '20', 'P2W', undefined, 5]) { expect(parseIsoDurationMs(bad)).toBeUndefined(); }
  });
});

describe('session idle timeout follows the server', () => {
  afterEach(() => { _invalidateSession(cfg); vi.useRealTimers(); });

  it('keeps a session alive past the old 15 min when the server holds it 2 h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    _setSession(cfg, { cookie: 'c', agent: undefined as never, cfg, lastUsed: 0 });
    await learnSessionTimeout(cfg, async () => ({ statusCode: 200, body: '{"value":"P0DT02H00M00S"}' }));
    expect(sessionExpiresAt(cfg)).toBe(2 * 3600_000 - 60_000);
    vi.setSystemTime(30 * 60_000);
    expect(_getSession(cfg)).toBeDefined();
    vi.setSystemTime(2 * 3600_000);
    expect(_getSession(cfg)).toBeUndefined();
    expect(sessionExpiresAt(cfg)).toBeUndefined();
  });

  it('stays on the cautious default when the server does not answer', async () => {
    await learnSessionTimeout({ ...cfg, username: 'other' } as Tm1Config, async () => { throw new Error('x'); });
    await learnSessionTimeout({ ...cfg, username: 'other2' } as Tm1Config, async () => ({ statusCode: 404, body: '' }));
  });
});

describe('sessionStatusPure', () => {
  const p = (name: string, expiresAt: number | undefined) => ({ serverId: name, name, expiresAt });
  it('plans the next expiry of a live session', () => {
    const all = [p('a', 50), p('b', undefined), p('c', 200), p('d', 150)];
    expect(nextExpiry(all, 100)).toBe(150);
    expect(nextExpiry([p('a', 50)], 100)).toBeUndefined();
  });
});

describe('serverState', () => {
  it('green while alive, yellow when expired or never opened, none when disconnected', async () => {
    const { serverState } = await import('../../commands/serverManager/sessionStatusPure');
    expect(serverState(true, 200, 100)).toBe('live');
    expect(serverState(true, 100, 100)).toBe('expired');
    expect(serverState(true, undefined, 100)).toBe('expired');
    expect(serverState(false, 200, 100)).toBe('disconnected');
  });
});
