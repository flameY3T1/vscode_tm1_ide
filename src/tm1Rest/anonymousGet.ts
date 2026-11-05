/**
 * One GET without credentials — for the endpoints that answer anonymously
 * (admin server list, type detection in the add-server form). Nothing is
 * sent that could count against `MaximumLoginAttempts`.
 *
 * Own small call instead of `transport/`: that stack always builds an
 * `Authorization` header from a `Tm1Config`.
 */
import * as http from 'http';
import * as https from 'https';

export interface AnonAnswer {
  status: number;
  /** Every `WWW-Authenticate` line, kept separate (see `offeredLogins`). */
  challenges: string[];
  body: string;
}

export function anonymousGet(url: string, rejectUnauthorized: boolean, timeoutMs: number): Promise<AnonAnswer> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  return new Promise<AnonAnswer>((resolve, reject) => {
    const req = (isHttps ? https : http).request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
      // `timeout` arms before the TCP connect; `req.setTimeout` alone only
      // after it — a firewall-dropped port then hung 138 s (2026-10-30).
      timeout: timeoutMs,
      ...(isHttps ? { rejectUnauthorized } : {}),
    }, (res) => {
      const challenges: string[] = [];
      for (let i = 0; i < res.rawHeaders.length; i += 2) {
        if (res.rawHeaders[i].toLowerCase() === 'www-authenticate') { challenges.push(res.rawHeaders[i + 1]); }
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        challenges,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error(`No answer from ${parsed.host} within ${timeoutMs} ms`), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}
