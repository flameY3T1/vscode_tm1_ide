/**
 * Vitest setupFiles entry — runs once before all tests.
 *
 * After Phase 3b of the tiSignatures JSON-asset split, the KNOWN_SIGNATURES
 * Map starts empty and must be populated by an init call. In production the
 * extension host (extension.ts) and webview bootstrap do this. For tests we
 * load the real `media/tiSignatures.json` here so any consumer module gets a
 * populated Map at import time.
 */
// Pin the time zone so every machine and CI agree on what "local" means.
// NOT UTC on purpose: the chore overview formats absolute instants in local
// time (choreOverviewPure.ts), and a UTC test box would let a regression back
// to UTC formatting pass unnoticed. Node re-reads process.env.TZ on assignment.
process.env.TZ = 'Europe/Berlin';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initKnownSignatures } from '../tiLogicVisualizer/tiSignatures';
import { parseSignaturesJson } from '../tiLogicVisualizer/tiSignaturesLoader';
import { initSignatureDocs } from '../tiLogicVisualizer/signatureDocs';

// P3-20: load docs FIRST so initKnownSignatures (which calls applySignatureDocs)
// finds the descriptions populated. Missing docs file is non-fatal — descriptions
// just fall back to undefined.
const docsPath = path.resolve(__dirname, '..', '..', 'media', 'tiSignatureDocs.json');
try {
  const docsText = fs.readFileSync(docsPath, 'utf8');
  const parsed = JSON.parse(docsText) as { version?: number; docs?: Record<string, { description: string; paramDocs?: Record<string, string> }> };
  if (parsed.version === 1 && parsed.docs) { initSignatureDocs(parsed.docs); }
} catch { /* asset absent in this checkout — docs stay empty */ }

const jsonPath = path.resolve(__dirname, '..', '..', 'media', 'tiSignatures.json');
const text = fs.readFileSync(jsonPath, 'utf8');
initKnownSignatures(parseSignaturesJson(text));

// ── Network kill switch ────────────────────────────────────────────────────
//
// A test with an incomplete mock used to run into the REAL network. That ends in
// a timeout whose message does not name the cause — you read "test timed
// out in 5000ms" and search the test code instead of the mock.
//
// The most common reason is exactly one (docs/architecture/import-rules.md, "Test mocks"): modules under
// `tm1Rest/` import the transport DIRECTLY (`tm1Rest/client`), because
// `no-tm1client-in-deep-layers` forbids them the facade. Anyone who only sets
// `vi.mock('../tm1Client')` mocks the facade — the deep layer keeps running
// into the network. Both paths must point to the same doubles.
//
// WHERE the bolt sits, and why NOT at `http.request`: `import * as http
// from 'http'` yields an ES module namespace object. Its [[Set]] always
// fails — measured in exactly this environment (vitest 4, `pool: 'vmForks'`):
// `Object.prototype.toString` says `[object Module]`, `isExtensible` is
// `false`, and both the assignment and `Object.defineProperty` throw
// `TypeError: Cannot redefine property: request`, even though the descriptor
// claims `writable: true`. This holds for this file as well as for the
// production code — both see the same immutable object. The
// CJS object from `createRequire('http')` can be written to, but it is
// a DIFFERENT instance; the namespace copy stays untouched (also
// measured). A bolt at `http.request` would therefore be one that silently does not
// hold.
//
// The load-bearing bolt therefore sits one layer deeper, at the point through
// which every outgoing TCP connection of this process must pass:
// `net.Socket.prototype.connect`. A prototype is an ordinary object and
// writable. It covers `http.request`, `https.request` (whose `tls.connect`
// builds on a `TLSSocket`, which inherits `connect` from `net.Socket`) and
// every raw socket alike — including those that would have slipped past a mock of
// `http.request`. `globalThis.fetch` is a normal
// global property and is additionally replaced directly, so that the message
// there can name the full URL instead of only host and port.
//
// EXCEPTION loopback (127.0.0.0/8, ::1, localhost) — justified: 17 test files
// use `startFakeTm1` (`src/test/__mocks__/fakeTm1Server.ts`) to start a
// REAL `http.createServer` on `127.0.0.1:0` and drive the real transport
// against it. That is not a hole in the mocks but the only way to check session cookies,
// 401 retry, gzip decompression and keep-alive at all — exactly the
// layer a mock would take away. The bolt targets the other
// kind of traffic: a real TM1 server. Its address is never loopback
// (this project's test server is 192.0.2.1:12357), and a
// configuration stub from a unit test (`https://x`, `http://src`) goes
// to a host name that is not loopback either. So the exception costs
// the bolt nothing of what it was written against.
//
// No other test in this project may make real network traffic; the
// live probes are separate local scripts and do NOT run under vitest.
// Proof that it bites: `src/test/netKillSwitch.test.ts`.
import * as net from 'node:net';

const NETZ_HINWEIS =
  "Wahrscheinlich fehlt der zweite Mock-Pfad: vi.mock('../tm1Rest/client', "
  + "async () => await import('../tm1Client')) — see docs/architecture/import-rules.md.";

const origConnect = net.Socket.prototype.connect;
const origFetch = globalThis.fetch;

function istLoopback(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h);
}

/**
 * The host the call is aimed at — `undefined` if none can be recognized
 * (Unix socket, passed file descriptor). Such calls are not
 * TM1 traffic and continue unhindered.
 */
function hostAus(args: unknown[]): string | undefined {
  for (const a of args) {
    if (typeof a === 'string') {
      try { return new URL(a).hostname; } catch { return a; }
    }
    if (a instanceof URL) { return a.hostname; }
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      for (const k of ['url', 'href'] as const) {
        if (typeof o[k] === 'string') {
          try { return new URL(o[k] as string).hostname; } catch { /* further below */ }
        }
      }
      const host = o.hostname ?? o.host;
      if (typeof host === 'string') { return host; }
    }
  }
  return undefined;
}

/** The target for the message — as complete as the call allows. */
function zielAus(args: unknown[]): string {
  for (const a of args) {
    if (typeof a === 'string') { return a; }
    if (a instanceof URL) { return a.toString(); }
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      for (const k of ['url', 'href'] as const) {
        if (typeof o[k] === 'string') { return o[k] as string; }
      }
      const host = o.hostname ?? o.host;
      if (typeof host === 'string') {
        const port = o.port === undefined || o.port === null ? '' : `:${String(o.port)}`;
        const pfad = typeof o.path === 'string' ? o.path : '';
        return `${host}${port}${pfad}`;
      }
    }
  }
  return 'unbekanntes Ziel';
}

/**
 * Node passes the normalized arguments to `Socket.prototype.connect` as ONE
 * array (`[options, callback]`) — without this flattening every
 * message from the http path would only say "unbekanntes Ziel" (unknown target), and the loopback exception
 * would never apply.
 */
function flach(roh: unknown[]): unknown[] {
  return roh.flatMap(a => (Array.isArray(a) ? a : [a]));
}

function pruefe(args: unknown[]): void {
  const host = hostAus(args);
  if (host === undefined || istLoopback(host)) { return; }
  throw new Error(`Test will ins Netz (${zielAus(args)}). ${NETZ_HINWEIS}`);
}

// Prototypes are ordinary objects — here the assignment takes effect.
(net.Socket.prototype as unknown as Record<string, unknown>).connect =
  function verweigereVerbindung(this: net.Socket, ...args: unknown[]): net.Socket {
    pruefe(flach(args));
    return (origConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  };

globalThis.fetch = ((...args: unknown[]) => {
  pruefe(flach(args));
  return (origFetch as unknown as (...a: unknown[]) => unknown)(...args);
}) as unknown as typeof fetch;
