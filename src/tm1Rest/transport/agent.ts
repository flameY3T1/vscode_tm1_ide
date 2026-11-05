import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import type { Tm1Config } from './types';
import { setRequestGateLimit } from './requestGate';
import { resolveProxy, type ProxyDecision, type ProxySettings } from './proxy';

/**
 * Pins the agent's socket-pool key to `host:port:tls`.
 *
 * Node builds the key under which an agent parks its keep-alive sockets from
 * the connection options — for HTTPS this includes `ca`, `cert`, `pfx`,
 * `secureProtocol` and related fields (`https.Agent#getName`). VS Code hooks
 * into the TLS setup with `http.systemCertificates` (default ON) and passes
 * different TLS options through on each request; that changes the key, the
 * parked socket is no longer found, and every request builds a new
 * connection.
 *
 * For TM1 that is expensive: the server binds the serving worker thread to
 * the TCP socket, so every new connection is a new thread — with CAM
 * authentication, up to the point of crashing CAM. Measured live
 * (2026-08-17): with the setting ON, 0 of 20 requests were reused; with it
 * OFF, 14 of 20. Turning the setting off is not an option — in corporate
 * environments the company CAs hang off it.
 *
 * The fixed key is safe because an agent here ALWAYS belongs to exactly one
 * `Tm1Config` (session-cache key resp. server URL for the threads poller):
 * the TLS trust setting is the same across all requests of this agent. It
 * still goes into the key so that a laxly checked socket can never serve a
 * strictly checked request.
 *
 * Measurements and derivation: docs/architecture/thread-stability.md.
 */
function pinPoolKey<A extends http.Agent | https.Agent>(agent: A, rejectUnauthorized: boolean): A {
  const tls = rejectUnauthorized ? 'strict' : 'lax';
  (agent as unknown as { getName: (o?: { host?: string; hostname?: string; port?: number | string }) => string })
    .getName = (o) => `${o?.host ?? o?.hostname ?? ''}:${o?.port ?? ''}:${tls}`;
  return agent;
}

/** Build the agent from an already-resolved decision. Pure w.r.t. its inputs. */
export function buildAgent(
  cfg: Tm1Config,
  isHttps: boolean,
  decision: ProxyDecision,
  endpointRejectUnauthorized: boolean,
  extraOpts?: http.AgentOptions,
): http.Agent | https.Agent {
  if (decision.mode === 'direct') {
    return isHttps
      ? pinPoolKey(new https.Agent({ keepAlive: true, rejectUnauthorized: endpointRejectUnauthorized, ...extraOpts }), endpointRejectUnauthorized)
      : pinPoolKey(new http.Agent({ keepAlive: true, ...extraOpts }), endpointRejectUnauthorized);
  }
  // Proxy mode. The PROXY-leg TLS honours http.proxyStrictSSL (decision.strictSSL);
  // relevant only for an https:// proxy URL. The TM1 ENDPOINT TLS (over the tunnel)
  // is honoured separately via the per-request options at the call sites
  // (http.ts sets rejectUnauthorized: cfg.rejectUnauthorized on the request).
  return isHttps
    ? pinPoolKey(new HttpsProxyAgent(decision.proxyUrl!, { keepAlive: true, rejectUnauthorized: decision.strictSSL, ...extraOpts }), endpointRejectUnauthorized)
    : pinPoolKey(new HttpProxyAgent(decision.proxyUrl!, { keepAlive: true, ...extraOpts }), endpointRejectUnauthorized);
}

/** Read VS Code's http.* proxy settings. The only vscode-touching helper here. */
function readHttpSettings(): ProxySettings {
  const c = vscode.workspace.getConfiguration('http');
  return {
    proxy: c.get<string>('proxy'),
    proxyStrictSSL: c.get<boolean>('proxyStrictSSL'),
    noProxy: c.get<string[]>('noProxy'),
  };
}

/** Default socket cap when `tm1.maxSockets` is unset — measured as free (§2.3). */
const DEFAULT_MAX_SOCKETS = 4;
const MAX_MAX_SOCKETS = 16;

/**
 * Socket-pool limits from the configured value. Pure — the vscode side reads
 * `readMaxSockets`.
 *
 * TM1 11.8 binds the serving worker thread to the TCP socket (measured live
 * 2026-08-17, threadSocketAffinityProbe.js): a pool without a
 * cap (Node default `maxSockets: Infinity`) therefore spawns a separate TM1
 * thread per parallel request, and because TM1 cleans up unused sockets after
 * 90-120 s, every new burst brings up a fresh batch of thread IDs. On CAM
 * servers, this sprawl crashes CAM. The cap costs nothing: 12 parallel reads
 * over 4.8 MB even run faster with 4 sockets than uncapped (60 ms vs. 70 ms —
 * 12 TLS handshakes cost more than the serialization saves). Details:
 * docs/architecture/thread-stability.md.
 *
 * `maxFreeSockets` is set alongside so Node never discards one of the open
 * sockets again — the pool is meant to stay put, not breathe.
 */
export function poolAgentOptions(configured: number | undefined): { maxSockets: number; maxFreeSockets: number } {
  const n = typeof configured === 'number' && Number.isFinite(configured)
    ? Math.min(MAX_MAX_SOCKETS, Math.max(1, Math.floor(configured)))
    : DEFAULT_MAX_SOCKETS;
  return { maxSockets: n, maxFreeSockets: n };
}

/**
 * Enters the configured cap into the concurrency brake (`requestGate.ts`).
 * Necessary because VS Code's proxy patch replaces our agent, which leaves
 * `maxSockets` on the agent without effect — the brake therefore sits in
 * front of the request. Callers: `extension.activate` and the config
 * listener.
 */
export function applyMaxSocketsSetting(): void {
  setRequestGateLimit(poolAgentOptions(readMaxSockets()).maxSockets);
}

/** Read the configured socket cap (`tm1.maxSockets`). */
function readMaxSockets(): number | undefined {
  return vscode.workspace.getConfiguration('tm1').get<number>('maxSockets');
}

/**
 * Resolve and build the agent for a TM1 config (reads settings + env).
 * Caller-supplied `extraOpts` win over the configured pool cap, so a dedicated
 * single-socket agent (threads poller, see `tm1Rest/threadApi.ts`) stays pinned.
 */
export function resolveAgent(cfg: Tm1Config, isHttps: boolean, extraOpts?: http.AgentOptions): http.Agent | https.Agent {
  const decision = resolveProxy(cfg.serverUrl, process.env, readHttpSettings());
  const opts = { ...poolAgentOptions(readMaxSockets()), ...extraOpts };
  return buildAgent(cfg, isHttps, decision, cfg.rejectUnauthorized, opts);
}
