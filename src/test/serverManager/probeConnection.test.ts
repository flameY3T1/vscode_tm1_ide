import { describe, it, expect } from 'vitest';
import { classifyProbeError } from '../../commands/serverManager/probeConnection';
import { swapScheme, probeWithFallback } from '../../commands/serverManager/probeConnection';
import type { ProbeResult } from '../../commands/serverManager/probeConnection';

describe('classifyProbeError', () => {
  it('classifies DNS / refused / timeout / tls / other', () => {
    expect(classifyProbeError({ code: 'ENOTFOUND' })).toBe('dns');
    expect(classifyProbeError({ code: 'EAI_AGAIN' })).toBe('dns');
    expect(classifyProbeError({ code: 'ECONNREFUSED' })).toBe('refused');
    expect(classifyProbeError({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyProbeError({ message: 'socket timeout' })).toBe('timeout');
    expect(classifyProbeError({ message: 'self signed certificate in chain' })).toBe('tls');
    expect(classifyProbeError({ code: 'CERT_HAS_EXPIRED' })).toBe('tls');
    expect(classifyProbeError({ code: 'EPIPE' })).toBe('other');
    // https:// against a plaintext port. Until 2026-08-29 this ended up in 'other',
    // which meant the scheme fallback below never kicked in.
    expect(classifyProbeError({
      code: 'EPROTO',
      message: 'write EPROTO 416896:error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER:tls_record.cc:127:',
    })).toBe('scheme');
    // http:// against a TLS-only port (measured 2026-10-30, 11.8).
    expect(classifyProbeError({ code: 'HPE_INVALID_CONSTANT', message: 'Parse Error: Expected HTTP/, RTSP/ or ICE/' })).toBe('scheme');
  });
});

describe('swapScheme', () => {
  it('swaps https<->http, else null', () => {
    expect(swapScheme('https://h:8010')).toBe('http://h:8010');
    expect(swapScheme('http://h:8010')).toBe('https://h:8010');
    expect(swapScheme('ftp://h')).toBeNull();
  });
});

describe('probeWithFallback', () => {
  const cfg: any = { serverUrl: 'https://h:8010' };
  const ok: ProbeResult = { ok: true, productVersion: '11.8' };
  const yes = async () => true;

  it('returns the first result unchanged on success (no fallback)', async () => {
    const r = await probeWithFallback(cfg, async () => ok);
    expect(r.ok).toBe(true);
    expect((r as any).appliedFallback).toBeUndefined();
  });

  it('on tls failure retries with rejectUnauthorized:false and reports it', async () => {
    const calls: any[] = [];
    const probe = async (c: any) => { calls.push(c); return calls.length === 1 ? { ok: false, kind: 'tls', message: 'cert' } as ProbeResult : ok; };
    const r = await probeWithFallback(cfg, probe, yes);
    expect(r.ok).toBe(true);
    expect(calls[1].rejectUnauthorized).toBe(false);
    expect((r as any).appliedFallback).toEqual({ rejectUnauthorized: false, note: 'tls' });
  });

  it('on refused failure retries with swapped scheme and reports it', async () => {
    const calls: any[] = [];
    const probe = async (c: any) => { calls.push(c); return calls.length === 1 ? { ok: false, kind: 'refused', message: 'refused' } as ProbeResult : ok; };
    const r = await probeWithFallback(cfg, probe, yes);
    expect(r.ok).toBe(true);
    expect(calls[1].serverUrl).toBe('http://h:8010');
    expect((r as any).appliedFallback).toEqual({ serverUrl: 'http://h:8010', note: 'http' });
  });

  it('on scheme failure retries with swapped scheme and reports it', async () => {
    // The actual trigger: `https://` on a port that speaks plaintext HTTP.
    // The swap was built for exactly this error, but only kicked in
    // on `refused` — and this variant reports `EPROTO`.
    const calls: any[] = [];
    const probe = async (c: any) => { calls.push(c); return calls.length === 1 ? { ok: false, kind: 'scheme', message: 'EPROTO' } as ProbeResult : ok; };
    const r = await probeWithFallback(cfg, probe, yes);
    expect(r.ok).toBe(true);
    expect(calls[1].serverUrl).toBe('http://h:8010');
    expect((r as any).appliedFallback).toEqual({ serverUrl: 'http://h:8010', note: 'http' });
  });

  it('never falls back on auth (401/403)', async () => {
    let n = 0;
    const probe = async () => { n++; return { ok: false, kind: 'auth', message: 'login' } as ProbeResult; };
    const r = await probeWithFallback(cfg, probe, yes);
    expect(n).toBe(1);
    expect(r.ok).toBe(false);
    expect((r as any).appliedFallback).toBeUndefined();
  });

  it('returns the original failure when the fallback attempt also fails', async () => {
    const probe = async () => ({ ok: false, kind: 'tls', message: 'cert' } as ProbeResult);
    const r = await probeWithFallback(cfg, probe, yes);
    expect(r.ok).toBe(false);
    expect((r as any).appliedFallback).toBeUndefined();
  });

  it('asks before a downgrade retry and sends nothing when declined', async () => {
    for (const kind of ['tls', 'scheme'] as const) {
      const asked: string[] = [];
      let n = 0;
      const probe = async () => { n++; return { ok: false, kind, message: 'x' } as ProbeResult; };
      const r = await probeWithFallback(cfg, probe, async (k) => { asked.push(k); return false; });
      expect(asked).toEqual([kind === 'tls' ? 'tls' : 'http']);
      expect(n).toBe(1);
      expect(r.ok).toBe(false);
    }
  });

  it('upgrades http→https without asking', async () => {
    const calls: any[] = [];
    const probe = async (c: any) => { calls.push(c); return calls.length === 1 ? { ok: false, kind: 'refused', message: 'refused' } as ProbeResult : ok; };
    const r = await probeWithFallback({ serverUrl: 'http://h:8010' } as any, probe, async () => { throw new Error('must not ask'); });
    expect((r as any).appliedFallback).toEqual({ serverUrl: 'https://h:8010', note: 'https' });
  });
  it('after an http→https upgrade lands on a self-signed cert, asks once more and switches both', async () => {
    const calls: any[] = [];
    const asked: string[] = [];
    const probe = async (c: any) => {
      calls.push(c);
      if (calls.length === 1) { return { ok: false, kind: 'scheme', message: 'parse' } as ProbeResult; }
      return c.rejectUnauthorized === false ? ok : { ok: false, kind: 'tls', message: 'cert' } as ProbeResult;
    };
    const r = await probeWithFallback({ serverUrl: 'http://h:8010', rejectUnauthorized: true } as any, probe, async (k) => { asked.push(k); return true; });
    expect(asked).toEqual(['tls']);
    expect((r as any).appliedFallback).toEqual({ serverUrl: 'https://h:8010', rejectUnauthorized: false, note: 'tls' });
  });
});
