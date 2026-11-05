import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as zlib from 'zlib';
import type * as http from 'http';
import { request, requestBinary, makeDecoder } from '../../../tm1Rest/transport/http';
import { buildHeaders } from '../../../tm1Rest/transport/auth';
import { _clearAllSessionsForTest } from '../../../tm1Rest/transport/session';
import { startFakeTm1, fakeConfig, type FakeTm1 } from '../../__mocks__/fakeTm1Server';

/**
 * Transparent HTTP response decompression (Accept-Encoding: gzip, deflate).
 * TM1 11.8 gzips JSON when asked (~68 % smaller on the wire), but Node's
 * http/https never inflate on their own — the zlib step in `_rawTransport`
 * does. The identity path must stay byte-identical for servers that ignore
 * the header (v12 is unverified).
 */

// German + € so a broken decode path would also surface as U+FFFD, and long
// enough to span several chunks / zlib flushes.
const PAYLOAD = JSON.stringify({
  value: Array.from({ length: 400 }, (_, i) => ({ Name: `Bahnhöfe_Süßwaren_Größe_€uro_${i}` })),
});

let fake: FakeTm1 | undefined;
let lastAcceptEncoding: string | undefined;

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  fake = await startFakeTm1((req, res) => {
    lastAcceptEncoding = req.headers['accept-encoding'];
    handler(req, res);
  });
  return `${fake.url}/api/v1/Cubes`;
}

beforeEach(() => { _clearAllSessionsForTest(); lastAcceptEncoding = undefined; });
afterEach(async () => { await fake?.close(); fake = undefined; });

describe('transport decompression — request header', () => {
  it('advertises gzip and deflate by default', () => {
    const h = buildHeaders(fakeConfig('http://localhost:8010'));
    expect(h['Accept-Encoding']).toBe('gzip, deflate');
  });

  it('lets a caller-supplied Accept-Encoding win (no duplicate header)', () => {
    const h = buildHeaders(fakeConfig('http://localhost:8010'), undefined, { 'accept-encoding': 'identity' });
    expect(h['Accept-Encoding']).toBeUndefined();
    expect(h['accept-encoding']).toBe('identity');
  });

  it('actually sends the header on the wire', async () => {
    const url = await serve((_req, res) => { res.statusCode = 200; res.end('{}'); });
    await request('GET', url, fakeConfig(fake!.url));
    expect(lastAcceptEncoding).toContain('gzip');
  });
});

describe('transport decompression — response body', () => {
  it('inflates a gzip response (multibyte intact)', async () => {
    const gz = zlib.gzipSync(Buffer.from(PAYLOAD, 'utf8'));
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gz);
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(PAYLOAD);
    expect(res.body).not.toContain('�');
  });

  it('inflates a deflate response', async () => {
    const df = zlib.deflateSync(Buffer.from(PAYLOAD, 'utf8'));
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'deflate');
      res.end(df);
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.body).toBe(PAYLOAD);
  });

  it('leaves an identity response untouched (no Content-Encoding header)', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.end(Buffer.from(PAYLOAD, 'utf8'));
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.body).toBe(PAYLOAD);
  });

  it('passes an unknown Content-Encoding through raw instead of guessing', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'exotic-v99');
      res.end('plain-bytes');
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.body).toBe('plain-bytes');
  });

  it('handles an empty gzip-labelled body (204) without a zlib error', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 204;
      res.setHeader('Content-Encoding', 'gzip');
      res.end();
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('handles Content-Length: 0 with a gzip header on a 200', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', '0');
      res.end();
    });
    const res = await request('GET', url, fakeConfig(fake!.url));
    expect(res.body).toBe('');
  });

  it('rejects on a corrupt gzip payload instead of hanging', async () => {
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'gzip');
      res.end(Buffer.from('this-is-not-gzip-at-all'));
    });
    await expect(request('GET', url, fakeConfig(fake!.url)))
      .rejects.toThrow(/could not be decompressed/);
  });

  it('rejects on a truncated gzip stream', async () => {
    const gz = zlib.gzipSync(Buffer.from(PAYLOAD, 'utf8'));
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gz.subarray(0, Math.floor(gz.length / 2)));
    });
    await expect(request('GET', url, fakeConfig(fake!.url))).rejects.toThrow(/could not be decompressed/);
  });

  it('inflates for the binary variant too (same collector seam)', async () => {
    const bin = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const gz = zlib.gzipSync(bin);
    const url = await serve((_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Encoding', 'gzip');
      res.end(gz);
    });
    const res = await requestBinary('GET', url, fakeConfig(fake!.url), undefined, 30000);
    expect(Buffer.compare(res.body, bin)).toBe(0);
  });
});

describe('makeDecoder', () => {
  it('returns a stream for gzip, deflate and br', () => {
    for (const enc of ['gzip', 'GZIP', 'x-gzip', 'deflate', ' br ']) {
      const d = makeDecoder(enc);
      expect(d, enc).toBeDefined();
      d?.destroy();
    }
  });

  it('returns undefined for identity, empty and unknown encodings', () => {
    for (const enc of [undefined, '', 'identity', 'compress', 'gzip, deflate']) {
      expect(makeDecoder(enc), String(enc)).toBeUndefined();
    }
  });
});
