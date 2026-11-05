import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { buildAgent, poolAgentOptions, resolveAgent } from '../../../tm1Rest/transport/agent';
import type { Tm1Config } from '../../../tm1Rest/transport/types';
import { HttpsProxyAgent as _HPA } from 'https-proxy-agent';

const cfg = { serverUrl: 'https://tm1.corp.com:12345', rejectUnauthorized: false } as Tm1Config;

describe('buildAgent', () => {
  it('direct https -> plain https.Agent', () => {
    const a = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, false);
    expect(a).toBeInstanceOf(https.Agent);
    expect(a).not.toBeInstanceOf(HttpsProxyAgent);
  });
  it('direct http -> plain http.Agent', () => {
    const a = buildAgent(cfg, false, { mode: 'direct', strictSSL: true }, false);
    expect(a).toBeInstanceOf(http.Agent);
  });
  it('proxy + https target -> HttpsProxyAgent', () => {
    const a = buildAgent(cfg, true, { mode: 'proxy', proxyUrl: 'http://p:8080', strictSSL: true }, false);
    expect(a).toBeInstanceOf(HttpsProxyAgent);
  });
  it('proxy + http target -> HttpProxyAgent', () => {
    const a = buildAgent(cfg, false, { mode: 'proxy', proxyUrl: 'http://p:8080', strictSSL: true }, false);
    expect(a).toBeInstanceOf(HttpProxyAgent);
  });
});

describe('buildAgent TLS axes + extraOpts', () => {
  it('proxy https agent: proxy-leg TLS uses decision.strictSSL (not endpoint)', () => {
    const strict = buildAgent(cfg, true, { mode: 'proxy', proxyUrl: 'https://p:8443', strictSSL: true }, false) as _HPA;
    const loose = buildAgent(cfg, true, { mode: 'proxy', proxyUrl: 'https://p:8443', strictSSL: false }, false) as _HPA;
    expect((strict as any).connectOpts.rejectUnauthorized).toBe(true);
    expect((loose as any).connectOpts.rejectUnauthorized).toBe(false);
  });
  it('extraOpts (maxSockets) flow into the direct agent', () => {
    const a = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, false, { maxSockets: 1 });
    expect(a.maxSockets).toBe(1);
  });
});

/**
 * Socket pool cap. Measured live against TM1 11.8 (2026-08-17): the server
 * binds the serving worker thread to the TCP socket, so an uncapped
 * pool (Node default maxSockets = Infinity) creates a separate TM1 thread for each
 * parallel request. See docs/architecture/thread-stability.md.
 */
describe('poolAgentOptions', () => {
  it('defaults to 4 sockets when nothing is configured', () => {
    expect(poolAgentOptions(undefined)).toEqual({ maxSockets: 4, maxFreeSockets: 4 });
  });
  it('keeps free sockets equal to max sockets so the pool never shrinks', () => {
    expect(poolAgentOptions(2)).toEqual({ maxSockets: 2, maxFreeSockets: 2 });
  });
  it('clamps 0 and negative values to a single socket', () => {
    expect(poolAgentOptions(0).maxSockets).toBe(1);
    expect(poolAgentOptions(-5).maxSockets).toBe(1);
  });
  it('clamps oversized values to 16', () => {
    expect(poolAgentOptions(999).maxSockets).toBe(16);
  });
  it('falls back to the default for non-numeric settings', () => {
    expect(poolAgentOptions('viele' as unknown as number).maxSockets).toBe(4);
    expect(poolAgentOptions(Number.NaN).maxSockets).toBe(4);
  });
  it('rounds fractional values down', () => {
    expect(poolAgentOptions(3.7).maxSockets).toBe(3);
  });
});

describe('resolveAgent socket pool', () => {
  const cfgLocal: Tm1Config = { serverUrl: 'https://tm1:8010/api/v1', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

  function mockSettings(maxSockets: unknown): void {
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(((section?: string) => ({
      get: (key: string) => {
        if (section === 'tm1' && key === 'maxSockets') { return maxSockets; }
        return undefined;
      },
    })) as unknown as typeof vscode.workspace.getConfiguration);
  }

  beforeEach(() => { vi.restoreAllMocks(); });

  it('caps the agent at the configured socket count', () => {
    mockSettings(2);
    expect(resolveAgent(cfgLocal, true).maxSockets).toBe(2);
  });

  it('uses the default cap when the setting is unset', () => {
    mockSettings(undefined);
    expect(resolveAgent(cfgLocal, true).maxSockets).toBe(4);
  });

  it('lets a caller override the cap — the threads poller pins one socket', () => {
    mockSettings(4);
    expect(resolveAgent(cfgLocal, true, { maxSockets: 1 }).maxSockets).toBe(1);
  });
});

/**
 * Pin down the pool key. Proven live (2026-08-17): with VS Code's
 * `http.systemCertificates` (default ON), 0 of 20 requests were handled over a
 * reused socket; with the setting OFF, 14 of 20.
 * For the system certificates, VS Code hooks into the TLS setup and passes
 * different TLS options per request; Node, however, builds the pool key of an
 * HTTPS agent from exactly these options (`Agent#getName`). If the
 * key changes, the parked socket is not found — and because TM1 binds the
 * worker thread to the socket, every request creates a new thread.
 * See docs/architecture/thread-stability.md.
 */
describe('buildAgent — stable pool key', () => {
  const opts = (extra: Record<string, unknown>) => ({ host: 'tm1', port: 12357, ...extra }) as never;

  it('ignores per-request TLS options so the socket pool stays one pool', () => {
    const a = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, false);
    const withCaA = a.getName(opts({ ca: 'CORP-CA-A' }));
    const withCaB = a.getName(opts({ ca: 'CORP-CA-B', secureContext: {} }));
    expect(withCaA).toBe(withCaB);
  });

  it('still separates different hosts and ports', () => {
    const a = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, false);
    expect(a.getName(opts({}))).not.toBe(a.getName({ host: 'other', port: 12357 } as never));
    expect(a.getName(opts({}))).not.toBe(a.getName({ host: 'tm1', port: 8010 } as never));
  });

  it('separates the two TLS trust settings — a lax socket must not serve a strict request', () => {
    const strict = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, true);
    const lax = buildAgent(cfg, true, { mode: 'direct', strictSSL: true }, false);
    expect(strict.getName(opts({}))).not.toBe(lax.getName(opts({})));
  });

  it('pins the key on proxy agents too', () => {
    const a = buildAgent(cfg, true, { mode: 'proxy', proxyUrl: 'http://p:8080', strictSSL: true }, false);
    expect(a.getName(opts({ ca: 'X' }))).toBe(a.getName(opts({ ca: 'Y' })));
  });

  it('plain http agents keep a stable key as well', () => {
    const a = buildAgent(cfg, false, { mode: 'direct', strictSSL: true }, false);
    expect(a.getName(opts({ ca: 'X' }))).toBe(a.getName(opts({ ca: 'Y' })));
  });
});
