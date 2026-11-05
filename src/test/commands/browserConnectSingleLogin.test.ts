import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

let release: (cookie: string) => void = () => undefined;
const { browserLogin } = vi.hoisted(() => ({
  browserLogin: vi.fn(() => new Promise(res => { release = (cookie: string) => res({ ok: true, cookie }); })),
}));
vi.mock('../../tm1Rest/transport/browserLogin', () => ({ browserLogin }));
// `carries()` asks the instance's data route: 200 only for the cookies listed here.
const { opens } = vi.hoisted(() => ({ opens: new Set<string>() }));
vi.mock('../../tm1Rest/transport/http', async (orig) => ({
  ...(await orig<typeof import('../../tm1Rest/transport/http')>()),
  _rawRequest: vi.fn(async (_m: string, _u: string, _c: unknown, _b: unknown, _t: unknown, _h: unknown, cookie: string) =>
    ({ statusCode: opens.has(cookie) ? 200 : 401, headers: {}, body: '' })),
}));

import { ensureBrowserSession } from '../../commands/serverManager/browserConnect';
import { _clearAllSessionsForTest, _getSessionForTest, _invalidateSession, _isAuthFailed, _markAuthFailed } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const db = (database: string): Tm1Config => ({
  serverUrl: 'https://eu-central-1.planninganalytics.saas.ibm.com',
  username: '', password: '', rejectUnauthorized: true, authType: 'browser',
  version: 'v12', v12: { instance: 'tenant', database },
} as Tm1Config);

describe('ensureBrowserSession: one login per host', () => {
  beforeEach(() => { _clearAllSessionsForTest(); browserLogin.mockClear(); });

  // A second browser on the same profile directory exits at once and the
  // second connect failed with "closed before the login finished".
  it('a second connect on the same host waits for the running login', async () => {
    const a = ensureBrowserSession(db('A'));
    const b = ensureBrowserSession(db('B'));
    await Promise.resolve();
    release('paSession=x');
    await Promise.all([a, b]);
    expect(browserLogin).toHaveBeenCalledTimes(1);
    expect(_getSessionForTest(db('A'))?.cookie).toBe('paSession=x');
    expect(_getSessionForTest(db('B'))?.cookie).toBe('paSession=x');
  });

  // Review 2026-10-26: a remembered "instance A was logged in" outlived A's
  // session, so A took B's cookies unchecked and the next 401 dropped them all.
  it('PAW: another instance\'s cookies are reused only when they open this instance', async () => {
    const paw = (inst: string): Tm1Config => ({
      serverUrl: `https://paw/api/v1/tm1/${inst}`, username: '', password: '', rejectUnauthorized: true, authType: 'browser',
    } as Tm1Config);
    const a = ensureBrowserSession(paw('A'));
    await Promise.resolve();
    release('paSession=a');
    await a;
    _invalidateSession(paw('A'));

    const b = ensureBrowserSession(paw('B'));
    await vi.waitFor(() => expect(browserLogin).toHaveBeenCalledTimes(2));
    release('paSession=b');
    await b;

    // B's cookies do not open A: A logs in on its own.
    const again = ensureBrowserSession(paw('A'));
    await vi.waitFor(() => expect(browserLogin).toHaveBeenCalledTimes(3));
    release('paSession=a2');
    await again;
    expect(_getSessionForTest(paw('A'))?.cookie).toBe('paSession=a2');

    // They do open C: no login.
    opens.add('paSession=b');
    _invalidateSession(paw('A'));
    await ensureBrowserSession(paw('C'));
    expect(browserLogin).toHaveBeenCalledTimes(3);
    expect(_getSessionForTest(paw('C'))?.cookie).toBe('paSession=b');
  });

  // Review 2026-10-25: a 401 on expired cookies marks the config failed; the
  // next login stored fresh cookies, yet every call stopped at the old guard.
  it('a fresh login clears the 401 guard of the expired session', async () => {
    _markAuthFailed(db('A'));
    const a = ensureBrowserSession(db('A'));
    await Promise.resolve();
    release('paSession=fresh');
    await a;
    expect(_isAuthFailed(db('A'))).toBe(false);
  });
});
