/**
 * Proof that the network kill switch from `src/test/setup.ts` really takes effect.
 *
 * Without this test the latch is a claim: it sits in a
 * `setupFiles` file, runs before every test run and fails SILENTLY if Node
 * or vitest ever bypass the blocked path (a new
 * `undici` version, a different pool, a prototype that someone overwrites
 * after the fact). Exactly the kind of failure you only notice when a test
 * once again hangs for minutes against a real server.
 *
 * Both things are checked: THAT each of the three paths throws, and that the message
 * names the target and the most common reason — a kill switch whose message hides
 * the cause would just be a faster timeout.
 */
import { describe, it, expect } from 'vitest';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';

describe('network kill switch (src/test/setup.ts)', () => {
  it('stops http.request and names host and port', () => {
    expect(() => http.request({ hostname: 'example.com', port: 80, path: '/x' }).end())
      .toThrow(/Test will ins Netz \(example\.com:80\)/);
  });

  it('stops https.request', () => {
    expect(() => https.request('https://example.com/y').end()).toThrow(/Test will ins Netz/);
  });

  it('stops a raw socket — including one that would slip past an http mock', () => {
    expect(() => net.connect(12357, '192.0.2.1')).toThrow(/Test will ins Netz \(192\.0\.2\.1:12357\)/);
  });

  it('stops fetch and names the full URL', () => {
    const f = globalThis.fetch as unknown as (u: string) => unknown;
    expect(() => f('https://example.com/z')).toThrow(/Test will ins Netz \(https:\/\/example\.com\/z\)/);
  });

  it('lets loopback through — the 17 files with a real test server need it', async () => {
    // The exception is justified in `setup.ts`; its proof lives here, so that
    // nobody closes it by accident and 17 transport test files fall over with a
    // message about missing mocks that are not missing there at all.
    const server = http.createServer((_req, res) => { res.end('ok'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/' }, (res) => {
          let b = '';
          res.on('data', (c: Buffer) => { b += c.toString(); });
          res.on('end', () => resolve(b));
        });
        req.on('error', reject);
        req.end();
      });
      expect(text).toBe('ok');
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('the message names the missing second mock path', () => {
    // The wording is the content: whoever ends up here has almost always only set
    // `vi.mock('../tm1Client')` and left the deep layer open.
    expect(() => http.request('http://a/').end())
      .toThrow(/vi\.mock\('\.\.\/tm1Rest\/client', async \(\) => await import\('\.\.\/tm1Client'\)\)/);
  });
});
