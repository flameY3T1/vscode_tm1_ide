import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _setSessionForTest,
  _getSessionForTest,
  _clearAllSessionsForTest,
  _touchSession,
  _setSessionIdleTimeoutForTest,
  _getSessionIdleTimeout,
  _invalidateSession,
} from '../tm1Rest/transport/session';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfgA: Tm1Config = {
  serverUrl: 'http://srv-a:8010',
  username: 'admin',
  password: 'pw',
  authType: 'Basic',
  rejectUnauthorized: false,
};
const cfgB: Tm1Config = { ...cfgA, serverUrl: 'http://srv-b:8010' };

describe('session idle-timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _clearAllSessionsForTest();
    _setSessionIdleTimeoutForTest(60 * 1000); // 60 s for fast tests
  });

  afterEach(() => {
    vi.useRealTimers();
    _clearAllSessionsForTest();
  });

  it('returns session before timeout', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=abc');
    vi.advanceTimersByTime(30 * 1000);
    expect(_getSessionForTest(cfgA)?.cookie).toBe('TM1SessionId=abc');
  });

  it('invalidates session after idle timeout', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=abc');
    vi.advanceTimersByTime(61 * 1000);
    expect(_getSessionForTest(cfgA)).toBeUndefined();
  });

  it('_touchSession extends the idle window', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=abc');
    vi.advanceTimersByTime(50 * 1000);
    _touchSession(cfgA);
    vi.advanceTimersByTime(50 * 1000);
    expect(_getSessionForTest(cfgA)?.cookie).toBe('TM1SessionId=abc');
  });

  it('_touchSession is no-op for missing session', () => {
    expect(() => _touchSession(cfgA)).not.toThrow();
  });

  it('isolates timeout per cfg', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=a1');
    vi.advanceTimersByTime(40 * 1000);
    _setSessionForTest(cfgB, 'TM1SessionId=b2');
    vi.advanceTimersByTime(30 * 1000);
    expect(_getSessionForTest(cfgA)).toBeUndefined();
    expect(_getSessionForTest(cfgB)?.cookie).toBe('TM1SessionId=b2');
  });

  it('default idle timeout is 15 min in production', () => {
    _setSessionIdleTimeoutForTest(15 * 60 * 1000);
    expect(_getSessionIdleTimeout()).toBe(15 * 60 * 1000);
  });

  it('idle drop does NOT destroy the agent (in-flight siblings survive)', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=abc');
    const agent = _getSessionForTest(cfgA)!.agent;
    const destroySpy = vi.spyOn(agent, 'destroy');
    vi.advanceTimersByTime(90 * 1000); // > 60 s idle
    expect(_getSessionForTest(cfgA)).toBeUndefined(); // entry dropped
    expect(destroySpy).not.toHaveBeenCalled();        // but agent left alive
  });

  it('_invalidateSession keeps agent alive by default, destroys only when asked', () => {
    _setSessionForTest(cfgA, 'TM1SessionId=abc');
    const agent = _getSessionForTest(cfgA)!.agent;
    const destroySpy = vi.spyOn(agent, 'destroy');
    // Default (401/re-mint path): drop entry, keep agent for in-flight siblings
    _invalidateSession(cfgA);
    expect(_getSessionForTest(cfgA)).toBeUndefined();
    expect(destroySpy).not.toHaveBeenCalled();

    // Explicit teardown (closeSession): destroy the agent
    _setSessionForTest(cfgA, 'TM1SessionId=def');
    const agent2 = _getSessionForTest(cfgA)!.agent;
    const destroySpy2 = vi.spyOn(agent2, 'destroy');
    _invalidateSession(cfgA, true);
    expect(destroySpy2).toHaveBeenCalledTimes(1);
  });
});
