// Live-smoke harness for proxy support (NOT part of the headless test run).
//
// Verifies the exact CONNECT + TLS-over-tunnel path that `resolveAgent` builds:
// spins up a local HTTP CONNECT proxy (no-auth and auth variants) and issues an
// HTTPS request to a TM1 server *through* the real `https-proxy-agent`.
//
// Credentials are read from the environment — nothing is hardcoded, so this file
// carries no secrets. Run against the internal test TM1 server, e.g.:
//
//   TM1_TEST_URL='https://<host>:<port>' \
//   TM1_TEST_USER='<user>' TM1_TEST_PASS='<pass>' \
//   node src/test/live/proxySmoke.mjs
//
// Expected output:
//   no-auth proxy : 200 <version>          (tunnel + TLS + REST OK)
//   auth ok       : 200 <version>          (proxy-auth accepted)
//   auth missing  : 407 ...                (proxy-auth enforced)

import net from 'node:net';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const TARGET = process.env.TM1_TEST_URL;
const USER = process.env.TM1_TEST_USER;
const PASS = process.env.TM1_TEST_PASS;
const PROXY_CRED = 'proxyuser:proxypass';
const PATH = '/api/v1/Configuration/ProductVersion/$value';

if (!TARGET || !USER || !PASS) {
  console.error('Set TM1_TEST_URL, TM1_TEST_USER, TM1_TEST_PASS in the environment.');
  process.exit(2);
}
const url = new URL(TARGET);
const TM1_AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

// --- Local CONNECT proxy (no deps) ---
function startProxy(requireAuth) {
  return new Promise((resolve) => {
    const srv = net.createServer((client) => {
      client.once('data', (buf) => {
        const head = buf.toString('utf8');
        const m = /^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/1\.[01]/i.exec(head.split('\r\n')[0]);
        if (!m) { client.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); return; }
        if (requireAuth) {
          const am = /\r\nProxy-Authorization:\s*Basic\s+(\S+)/i.exec(head);
          const ok = am && Buffer.from(am[1], 'base64').toString() === PROXY_CRED;
          if (!ok) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n'); return; }
        }
        const up = net.connect(+m[2], m[1], () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          up.pipe(client); client.pipe(up);
        });
        up.on('error', () => client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
      });
      client.on('error', () => {});
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, srv }));
  });
}

// --- Client: HTTPS to TM1 through the proxy via the real HttpsProxyAgent ---
function fetchVia(proxyPort, cred) {
  return new Promise((resolve) => {
    const proxyUrl = cred ? `http://${cred}@127.0.0.1:${proxyPort}` : `http://127.0.0.1:${proxyPort}`;
    const agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    const req = https.get(
      { host: url.hostname, port: url.port, path: PATH, agent, rejectUnauthorized: false, headers: { Authorization: TM1_AUTH } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(`${res.statusCode} ${b.trim().slice(0, 40)}`)); },
    );
    req.on('error', (e) => resolve(`ERR ${e.message}`));
    req.setTimeout(8000, () => { req.destroy(); resolve('ERR timeout'); });
  });
}

let p = await startProxy(false);
console.log('no-auth proxy :', await fetchVia(p.port, null)); p.srv.close();

p = await startProxy(true);
console.log('auth ok       :', await fetchVia(p.port, PROXY_CRED));
console.log('auth missing  :', await fetchVia(p.port, null)); p.srv.close();

process.exit(0);
