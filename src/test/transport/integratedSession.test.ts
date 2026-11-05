import { describe, it, expect, vi } from 'vitest';
import { mintIntegratedCookie, setIntegratedLoginLog } from '../../tm1Rest/transport/integratedSession';
import { buildType1, parseType2, authorizationHeader } from '../../tm1Rest/transport/ntlm';
import { buildTm1Config } from '../../tm1Rest/transport/authConfig';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const BASE = { serverUrl: 'http://tm1host:8010', username: '', password: '', rejectUnauthorized: false };
const cfg = (over: Partial<Tm1Config> = {}): Tm1Config =>
  ({ ...buildTm1Config(BASE, { authType: 'integrated' }), ...over } as Tm1Config);

const CHALLENGE_401 = ['Negotiate', 'Basic realm="TM1"'];

/**
 * A Type 2 as TM1 sends it (raw NTLMSSP, with TargetName and TargetInfo).
 * Computed from the building kit instead of stored as a base64 blob — that keeps
 * the test readable, and it breaks when the format changes.
 */
function type2(): Buffer {
  const target = Buffer.from('TM1HOST', 'ucs2');
  const info = Buffer.concat([
    Buffer.from([0x02, 0x00]), Buffer.from([target.length, 0x00]), target, // NbDomainName
    Buffer.from([0x00, 0x00, 0x00, 0x00]),                                // EOL
  ]);
  const head = Buffer.alloc(48);
  head.write('NTLMSSP\0', 0, 'latin1');
  head.writeUInt32LE(2, 8);
  head.writeUInt16LE(target.length, 12);
  head.writeUInt16LE(target.length, 14);
  head.writeUInt32LE(48, 16);
  head.writeUInt32LE(0xA28A8205, 20);
  Buffer.from('12345678', 'latin1').copy(head, 24);
  head.writeUInt16LE(info.length, 40);
  head.writeUInt16LE(info.length, 42);
  head.writeUInt32LE(48 + target.length, 44);
  return Buffer.concat([head, target, info]);
}

/**
 * Answers like a TM1 in mode 2. Decides by the MESSAGE TYPE, not by a
 * counter: the SSO path makes two attempts (Negotiate, then NTLM), and a
 * counter would refuse the challenge to the second Type 1.
 */
function fakeServer(options: {
  finalStatus?: number;
  cookie?: string;
  challengeOnSecondLeg?: boolean;
  portSequence?: number[];
} = {}) {
  const calls: { authorization: string | undefined }[] = [];
  let leg = 0;
  const ports = options.portSequence ?? [];
  const request = vi.fn(async (_url: string, authorization: string | undefined) => {
    calls.push({ authorization });
    const localPort = ports[leg] ?? 54321;
    leg += 1;
    if (!authorization) {
      return { status: 401, challenges: CHALLENGE_401, setCookie: undefined, localPort };
    }
    const token = Buffer.from(authorization.slice(authorization.indexOf(' ') + 1), 'base64');
    const messageType = token.subarray(0, 8).toString('latin1') === 'NTLMSSP\0' ? token.readUInt32LE(8) : 0;
    if (messageType === 1) {
      return options.challengeOnSecondLeg === false
        ? { status: 401, challenges: CHALLENGE_401, setCookie: undefined, localPort }
        : {
          status: 401,
          challenges: [`Negotiate ${type2().toString('base64')}`],
          setCookie: undefined,
          localPort,
        };
    }
    const status = options.finalStatus ?? 200;
    const cookie = options.cookie ?? 'TM1SessionId=abc';
    return {
      status,
      challenges: status === 401 ? CHALLENGE_401 : [],
      setCookie: status >= 200 && status < 300 ? [`${cookie}; Path=/api/; HttpOnly`] : undefined,
      localPort,
    };
  });
  return { request, calls };
}

const sspiDeps = () => ({
  sspiAvailable: () => true,
  reverseNames: async () => [],
  startSspi: vi.fn(async (_spn: string, _tmpRoot?: string, _package?: 'Kerberos' | 'Negotiate' | 'NTLM') => ({
    negotiate: buildType1(),
    identity: 'TM1HOST\\user1',
    authenticate: vi.fn(async (challenge: Buffer) => {
      // The context receives the real challenge — that is the contract that
      // `sspiNtlm` fulfils; here we only prove that it arrives.
      expect(parseType2(challenge).targetName).toBe('TM1HOST');
      const type3 = Buffer.alloc(64);
      type3.write('NTLMSSP\0', 0, 'latin1');
      type3.writeUInt32LE(3, 8);
      return type3;
    }),
    dispose: vi.fn(),
  })),
});

describe('mintIntegratedCookie', () => {
  it('runs both legs and mints the cookie (passwordless, SSPI)', async () => {
    const server = fakeServer();
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...sspiDeps() });
    expect(out).toMatchObject({ ok: true, cookie: 'TM1SessionId=abc' });
    // Three requests: unauthorized, Type 1, Type 3 — and the last two
    // carry NTLM messages under the scheme name `Negotiate`.
    expect(server.calls).toHaveLength(3);
    expect(server.calls[0].authorization).toBeUndefined();
    expect(server.calls[1].authorization).toMatch(/^Negotiate TlRMTVNTUAABAAAA/);
    expect(server.calls[2].authorization).toMatch(/^Negotiate /);
  });

  it('computes NTLMv2 itself when credentials are typed in', async () => {
    const server = fakeServer();
    const out = await mintIntegratedCookie(
      cfg({ username: 'TM1HOST\\user1', password: 'geheim' }),
      { request: server.request, sspiAvailable: () => false },
    );
    expect(out).toMatchObject({ ok: true });
    // No SSPI involved, and the Type 3 carries content (not the empty
    // message that curl sent).
    const type3 = Buffer.from(server.calls[2].authorization!.slice('Negotiate '.length), 'base64');
    expect(type3.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
    expect(type3.readUInt32LE(8)).toBe(3);
    expect(type3.readUInt16LE(20)).toBeGreaterThan(0); // NtChallengeResponse len
    expect(type3.readUInt16LE(36)).toBeGreaterThan(0); // UserName len
  });

  it('sends exactly the typed name — without a domain means without a domain', async () => {
    // Substituting the server domain instead turned `user1` into
    // `DOMAIN\user1`; a TM1 with client `user1` rejected that.
    const server = fakeServer();
    await mintIntegratedCookie(cfg({ username: 'user1', password: 'geheim' }),
      { request: server.request, sspiAvailable: () => false });
    const type3 = Buffer.from(server.calls[2].authorization!.slice('Negotiate '.length), 'base64');
    const domainLen = type3.readUInt16LE(28);
    const userLen = type3.readUInt16LE(36);
    const userOff = type3.readUInt32LE(40);
    expect(domainLen).toBe(0);
    expect(type3.subarray(userOff, userOff + userLen).toString('ucs2')).toBe('user1');
  });

  it('takes the domain part when it is typed in', async () => {
    const server = fakeServer();
    await mintIntegratedCookie(cfg({ username: 'CONTOSO\\user1', password: 'geheim' }),
      { request: server.request, sspiAvailable: () => false });
    const type3 = Buffer.from(server.calls[2].authorization!.slice('Negotiate '.length), 'base64');
    const domainLen = type3.readUInt16LE(28);
    const domainOff = type3.readUInt32LE(32);
    expect(type3.subarray(domainOff, domainOff + domainLen).toString('ucs2')).toBe('CONTOSO');
  });

  it('falls back to the next package when SSPI cannot even start it', async () => {
    // Finding from the Codex review 2026-09-17 (1): `startSspi` stood outside of
    // `try`, so a throw ended the whole flow — the announced
    // fallback never happened.
    const server = fakeServer();
    const base = sspiDeps();
    const started: string[] = [];
    const startSspi = vi.fn(async (_spn: string, _tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      started.push(pkg!);
      if (pkg === 'Kerberos') { throw new Error('SEC_E_NO_CREDENTIALS'); }
      return base.startSspi(_spn, _tmp, pkg);
    });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...base, startSspi });
    expect(out).toMatchObject({ ok: true, cookie: 'TM1SessionId=abc' });
    expect(started[0]).toBe('Kerberos');
    expect(started).toContain('Negotiate');
  });

  it('also falls back when the token only fails while answering', async () => {
    const server = fakeServer();
    const base = sspiDeps();
    let first = true;
    const startSspi = vi.fn(async (_spn: string, _tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      const hs = await base.startSspi(_spn, _tmp, pkg);
      if (first) {
        first = false;
        return { ...hs, authenticate: vi.fn(async () => { throw new Error('SEC_E_INVALID_TOKEN'); }) };
      }
      return hs;
    });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...base, startSspi });
    expect(out).toMatchObject({ ok: true });
    expect(startSspi.mock.calls.length).toBeGreaterThan(1);
  });

  it('names klist and setspn with the tried service name when every package fails', async () => {
    // A consultant at the customer has to help themselves: the message names the
    // two Windows commands that tell "no ticket" from "SPN not registered".
    const server = fakeServer();
    const startSspi = vi.fn(async () => { throw new Error('SEC_E_NO_CREDENTIALS'); });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...sspiDeps(), startSspi });
    expect(out.ok).toBe(false);
    const message = (out as { message: string }).message;
    expect(message).toContain('`klist`');
    expect(message).toMatch(/`setspn -Q HTTP\/[^`]+`/);
  });

  it('passes a network error through instead of dismissing it as a package error', async () => {
    // An ECONNREFUSED or certificate error belongs upstream — otherwise
    // the caller loses the certificate button and the network diagnosis.
    const request = vi.fn(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); });
    await expect(mintIntegratedCookie(cfg(), { request, ...sspiDeps() })).rejects.toThrow('refused');
  });

  it('passes a SPNEGO token on to SSPI instead of discarding it', async () => {
    // Finding (2): `extractChallengeToken` only let `NTLMSSP\0` through. Because of that
    // the Kerberos path could never come about — SPNEGO starts with an
    // ASN.1 SEQUENCE (0x60).
    const spnego = Buffer.concat([Buffer.from([0x60, 0x06]), Buffer.from('kerbtoken')]);
    let seen: Buffer | undefined;
    const request = vi.fn(async (_url: string, authorization: string | undefined) => {
      if (!authorization) { return { status: 401, challenges: CHALLENGE_401, setCookie: undefined, localPort: 1 }; }
      const token = Buffer.from(authorization.slice(authorization.indexOf(' ') + 1), 'base64');
      if (token.subarray(0, 8).toString('latin1') === 'NTLMSSP\0' && token.readUInt32LE(8) === 1) {
        return { status: 401, challenges: [`Negotiate ${spnego.toString('base64')}`], setCookie: undefined, localPort: 1 };
      }
      return { status: 200, challenges: [], setCookie: ['TM1SessionId=kerb; Path=/api/'], localPort: 1 };
    });
    const base = sspiDeps();
    const startSspi = vi.fn(async (spn: string, tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      const hs = await base.startSspi(spn, tmp, pkg);
      return { ...hs, authenticate: vi.fn(async (challenge: Buffer) => { seen = challenge; return Buffer.from('spnego-response'); }) };
    });
    const out = await mintIntegratedCookie(cfg(), { request, ...base, startSspi });
    expect(seen && [...seen]).toEqual([...spnego]);
    expect(out).toMatchObject({ ok: true, cookie: 'TM1SessionId=kerb' });
  });

  it('accepts a success after the FIRST token — that is what Kerberos looks like', async () => {
    // Finding (3): a `200` with a cookie and no further challenge ended up in
    // `noChallenge()`; the finished session was thrown away and further
    // packages were tried.
    const request = vi.fn(async (_url: string, authorization: string | undefined) => (authorization
      ? { status: 200, challenges: [], setCookie: ['TM1SessionId=one-shot; Path=/api/'], localPort: 7 }
      : { status: 401, challenges: CHALLENGE_401, setCookie: undefined, localPort: 7 }));
    const deps = sspiDeps();
    const out = await mintIntegratedCookie(cfg(), { request, ...deps });
    expect(out).toMatchObject({ ok: true, cookie: 'TM1SessionId=one-shot' });
    expect(deps.startSspi).toHaveBeenCalledTimes(1);
  });

  it('reports a connection change between the legs instead of suspecting the computation', async () => {
    const server = fakeServer({ portSequence: [1000, 1000, 2000] });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...sspiDeps() });
    expect(out).toMatchObject({ ok: false });
    expect((out as { message: string }).message).toContain('lost its connection');
  });

  it('names the security mode when the server offers no NTLM scheme', async () => {
    const request = vi.fn(async () => ({
      status: 401, challenges: ['Basic realm="TM1"'], setCookie: undefined, localPort: 1,
    }));
    const out = await mintIntegratedCookie(cfg(), { request, ...sspiDeps() });
    expect((out as { message: string }).message).toContain('IntegratedSecurityMode 2, 3 or 5');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('says so when no challenge comes back for the Type 1', async () => {
    const server = fakeServer({ challengeOnSecondLeg: false });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...sspiDeps() });
    expect((out as { message: string }).message).toContain('not an integrated-login endpoint');
  });

  it('tries Kerberos first and falls back via SPNEGO to NTLM', async () => {
    // Passwordless, so there is no risk of a lockout.
    const server = fakeServer({ finalStatus: 401 });
    const deps = sspiDeps();
    await mintIntegratedCookie(cfg(), { request: server.request, ...deps });
    // Kerberos first (does not degrade), then SPNEGO, then raw NTLM.
    expect(deps.startSspi.mock.calls.map(c => c[2])).toEqual(['Kerberos', 'Negotiate', 'NTLM']);
  });

  it('stops at the first package as soon as it works', async () => {
    const server = fakeServer();
    const deps = sspiDeps();
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...deps });
    expect(out).toMatchObject({ ok: true });
    expect(deps.startSspi).toHaveBeenCalledTimes(1);
  });

  it('on rejection names the identity and where the reason is recorded', async () => {
    const server = fakeServer({ finalStatus: 401 });
    const out = await mintIntegratedCookie(cfg(), { request: server.request, ...sspiDeps() });
    expect(out).toMatchObject({ ok: false, status: 401 });
    const message = (out as { message: string }).message;
    // The name carries the SSPI package used, so that the message says which
    // path failed (Kerberos first, then NTLM).
    expect(message).toContain('TM1HOST\\user1 (NTLM, HTTP/tm1host)');
    expect(message).toContain('4625');
  });

  it('without Windows points to the typed-in credentials', async () => {
    const server = fakeServer();
    const out = await mintIntegratedCookie(cfg(), { request: server.request, sspiAvailable: () => false });
    expect((out as { message: string }).message).toContain('DOMAIN\\user');
  });

  it('uses the FQDN for the service name, not the short name', async () => {
    // Short name → SEC_E_TARGET_UNKNOWN, because SPNs are bound to the FQDN.
    const server = fakeServer();
    const deps = { ...sspiDeps(), reverseNames: async () => ['tm1host.corp.example.com'] };
    await mintIntegratedCookie(cfg(), { request: server.request, ...deps });
    expect(deps.startSspi.mock.calls[0][0]).toBe('HTTP/tm1host.corp.example.com');
  });

  it('does not let a foreign reverse name bend the service name', async () => {
    const server = fakeServer();
    const deps = { ...sspiDeps(), reverseNames: async () => ['loadbalancer.example.com'] };
    await mintIntegratedCookie(cfg(), { request: server.request, ...deps });
    expect(deps.startSspi.mock.calls[0][0]).toBe('HTTP/tm1host');
  });

  it('takes the SPN from the profile over reverse DNS, and says so in the log', async () => {
    const server = fakeServer();
    const deps = { ...sspiDeps(), reverseNames: async () => ['tm1host.corp.example.com'] };
    const lines: string[] = [];
    setIntegratedLoginLog(l => lines.push(l));
    try {
      await mintIntegratedCookie(cfg({ spn: 'HTTP/tm1-svc.corp.example.com' } as Partial<Tm1Config>), { request: server.request, ...deps });
    } finally {
      setIntegratedLoginLog(undefined);
    }
    expect(deps.startSspi.mock.calls[0][0]).toBe('HTTP/tm1-svc.corp.example.com');
    expect(lines).toContain('Kerberos service name HTTP/tm1-svc.corp.example.com (from the profile)');
  });

  it('logs every Windows package it drops, with the reason', async () => {
    const server = fakeServer();
    const base = sspiDeps();
    const startSspi = vi.fn(async (spn: string, tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      if (pkg === 'Kerberos') { throw new Error('SEC_E_TARGET_UNKNOWN'); }
      return base.startSspi(spn, tmp, pkg);
    });
    const lines: string[] = [];
    setIntegratedLoginLog(l => lines.push(l));
    try {
      await mintIntegratedCookie(cfg(), { request: server.request, ...base, startSspi });
    } finally {
      setIntegratedLoginLog(undefined);
    }
    expect(lines).toContain('Windows package dropped: Kerberos: SEC_E_TARGET_UNKNOWN');
  });

  it('is not responsible for v12 at all', async () => {
    // v12 mints via `/{instance}/auth/v1/session` — there is no NTLM there.
    const v12 = { ...BASE, authType: 'integrated', version: 'v12' } as unknown as Tm1Config;
    const request = vi.fn();
    const out = await mintIntegratedCookie(v12, { request });
    expect((out as { message: string }).message).toContain('v11 only');
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts a cookie even without login protection', async () => {
    const request = vi.fn(async () => ({
      status: 200, challenges: [], setCookie: ['TM1SessionId=open; Path=/api/'], localPort: 1,
    }));
    await expect(mintIntegratedCookie(cfg(), { request })).resolves.toMatchObject({ ok: true, cookie: 'TM1SessionId=open' });
  });

  it('attaches the NTLM message to the scheme that the server names', () => {
    // The name is `Negotiate`, the content is NTLM — the whole path depends on that.
    expect(authorizationHeader('Negotiate', Buffer.from('x'))).toBe('Negotiate eA==');
    expect(authorizationHeader('NTLM', Buffer.from('x'))).toBe('NTLM eA==');
  });
});

describe('mintIntegratedCookie through PAW', () => {
  // Replays the sequence measured 2026-09-29 against a company PAW
  // (pawNtlmProbe.mjs): two logins, the second one answering
  // 403 with its schemes only in the body.
  function fakePaw() {
    const calls: { url: string; authorization?: string; method?: string; form?: string; cookie?: string }[] = [];
    const request = vi.fn(async (url: string, authorization: string | undefined, _agent: unknown, _ru: boolean,
      extra: { method?: string; form?: string; cookie?: string } = {}) => {
      calls.push({ url, authorization, ...extra });
      const localPort = url.endsWith('/login') ? 1001 : 1002;
      const token = authorization ? Buffer.from(authorization.slice(authorization.indexOf(' ') + 1), 'base64') : undefined;
      const type = token && token.subarray(0, 8).toString('latin1') === 'NTLMSSP\0' ? token.readUInt32LE(8) : 0;
      if (type === 1) {
        return { status: 401, challenges: [`Negotiate ${type2().toString('base64')}`], setCookie: undefined, localPort };
      }
      if (url.endsWith('/login')) {
        return type === 3
          ? { status: 200, challenges: [], setCookie: ['ba-sso-csrf=c1; Path=/', 'paSession=s2; Path=/'], localPort, body: '{"success":true}' }
          : { status: 401, challenges: ['Negotiate'], setCookie: ['paSession=s1; Path=/'], localPort };
      }
      return type === 3
        ? { status: 200, challenges: [], setCookie: undefined, localPort, body: '{"success":true}' }
        : {
          status: 403, challenges: [], setCookie: ['TM1SessionId_Planning=t1; Path=/'], localPort,
          body: '{"error":{"message":"Authentication required","statusCode":403,"authenticate":{"Negotiate":"","Basic":"realm=\\"TM1\\""}}}',
        };
    });
    return { request, calls };
  }

  it('logs in at PAW and at the instance and carries all cookies forward', async () => {
    const paw = fakePaw();
    const base = sspiDeps();
    // Kerberos cannot start here, so the NTLM path runs as measured.
    const startSspi = vi.fn(async (spn: string, tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      if (pkg === 'Kerberos') { throw new Error('SEC_E_NO_CREDENTIALS'); }
      return base.startSspi(spn, tmp, pkg);
    });
    const out = await mintIntegratedCookie(
      cfg({ serverUrl: 'https://paw.example/api/v1/tm1/Planning' }),
      { request: paw.request, ...base, startSspi },
    );
    expect(out).toMatchObject({ ok: true, cookie: 'paSession=s2; ba-sso-csrf=c1; TM1SessionId_Planning=t1' });
    const first = paw.calls.filter(c => c.url === 'https://paw.example/login');
    expect(first.every(c => c.method === 'POST' && c.form === 'mode=negotiate')).toBe(true);
    const second = paw.calls.filter(c => c.url === 'https://paw.example/login/tm1/Planning');
    // The Type 1 went out although the 403 carried no WWW-Authenticate header.
    expect(second.map(c => c.authorization?.slice(0, 22))).toEqual([undefined, 'Negotiate TlRMTVNTUAAB', 'Negotiate TlRMTVNTUAAD']);
    expect(second[0].cookie).toBe('paSession=s2; ba-sso-csrf=c1');
  });

  it('retries the instance step once when its step hangs without a login', async () => {
    const paw = fakePaw();
    let hung = false;
    const request = vi.fn(async (url: string, authorization: string | undefined, a: unknown, ru: boolean, extra?: object) => {
      if (!hung && url.endsWith('/login/tm1/Planning') && !authorization) {
        hung = true;
        throw new Error('Integrated login timed out');
      }
      return paw.request(url, authorization, a, ru, extra);
    });
    const base = sspiDeps();
    const startSspi = vi.fn(async (spn: string, tmp?: string, pkg?: 'Kerberos' | 'Negotiate' | 'NTLM') => {
      if (pkg === 'Kerberos') { throw new Error('SEC_E_NO_CREDENTIALS'); }
      return base.startSspi(spn, tmp, pkg);
    });
    const out = await mintIntegratedCookie(
      cfg({ serverUrl: 'https://paw.example/api/v1/tm1/Planning' }),
      { request, ...base, startSspi },
    );
    expect(out).toMatchObject({ ok: true });
    expect(hung).toBe(true);
  });

  it('leaves a direct TM1 URL on the existing path', async () => {
    const server = fakeServer();
    await mintIntegratedCookie(cfg({ serverUrl: 'https://tm1host:8010' }), { request: server.request, ...sspiDeps() });
    expect(server.request.mock.calls[0][0]).toBe('https://tm1host:8010/api/v1/Configuration');
  });
});
