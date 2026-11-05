import { describe, expect, it } from 'vitest';
import { loginMismatch, offeredLogins } from '../../tm1Rest/transport/authChallengePure';
import { fetchAuthChallenges } from '../../tm1Rest/transport/integratedSession';
import type { Tm1Config } from '../../tm1Rest/transport/types';

describe('offeredLogins', () => {
  it('reads the v11.8 mode-1 answer (measured 2026-10-09)', () => {
    expect(offeredLogins(['Basic realm="TM1"'])).toEqual(['Basic']);
  });

  it('reads the PAW gateway list and ignores Bearer (measured 2026-09-17)', () => {
    expect(offeredLogins(['Bearer realm="Service"', 'Negotiate', 'Basic realm="TM1"']).sort())
      .toEqual(['Basic', 'integrated']);
  });

  it('splits comma-joined schemes and maps NTLM and CAM*', () => {
    expect(offeredLogins(['NTLM, CAMPassport http://cognos/ibmcognos']).sort()).toEqual(['CAM', 'integrated']);
  });

  it('is empty for a v12 401 without WWW-Authenticate (measured 2026-10-09)', () => {
    expect(offeredLogins([])).toEqual([]);
  });
});

describe('loginMismatch', () => {
  it('names the offered logins when the chosen one is missing', () => {
    expect(loginMismatch('Basic', ['integrated'])).toEqual(['integrated']);
  });

  it('stays silent when the chosen login is offered', () => {
    expect(loginMismatch('Basic', ['Basic', 'integrated'])).toBeUndefined();
  });

  it('stays silent when the server names nothing', () => {
    expect(loginMismatch('CAM', [])).toBeUndefined();
  });
});

describe('fetchAuthChallenges', () => {
  const cfg = { serverUrl: 'https://tm1:12357', rejectUnauthorized: false, username: 'u', password: 'p' } as Tm1Config;

  it('sends NO Authorization header and returns header plus body schemes', async () => {
    const seen: Array<string | undefined> = [];
    const out = await fetchAuthChallenges(cfg, {
      request: async (_url, authorization) => {
        seen.push(authorization);
        return { status: 401, challenges: ['Basic realm="TM1"'], setCookie: undefined, localPort: undefined, body: '{"error":{"authenticate":{"Negotiate":{}}}}' };
      },
    });
    expect(seen).toEqual([undefined]);
    expect(out).toEqual(['Basic realm="TM1"', 'Negotiate']);
  });
});
