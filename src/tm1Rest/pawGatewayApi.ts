/** Small vscode-free PAW discovery transport. Redirects are intentionally not followed. */
import * as http from 'http';
import * as https from 'https';
import {
  encodePawInstanceName,
  normalizePawGatewayUrl,
  PawGatewayError,
} from './pawGatewayUrl';
import { isPawAuthRequired } from '../utils/pawTarget';

export interface PawInstance {
  name: string;
  acceptingClients: boolean;
  /** PA SaaS reports `isV12: true`; a v11 PAW leaves it out. */
  isV12?: boolean;
}

interface RawPawInstance {
  Name?: unknown;
  AcceptingClients?: unknown;
  isV12?: unknown;
}

function parseInstances(body: string): PawInstance[] {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new PawGatewayError('Failed to parse PAW gateway response as JSON', 'response');
  }
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { value?: unknown }).value)) {
    throw new PawGatewayError('PAW gateway response must contain a value array', 'response');
  }

  const names = new Set<string>();
  return (value as { value: RawPawInstance[] }).value.map((row) => {
    if (typeof row !== 'object' || row === null
      || typeof row.Name !== 'string' || typeof row.AcceptingClients !== 'boolean') {
      throw new PawGatewayError('PAW gateway response contains an invalid server row', 'response');
    }
    encodePawInstanceName(row.Name);
    if (names.has(row.Name)) {
      throw new PawGatewayError('PAW gateway response contains duplicate server names', 'response');
    }
    names.add(row.Name);
    return { name: row.Name, acceptingClients: row.AcceptingClients, ...(row.isV12 === true ? { isV12: true } : {}) };
  });
}

/**
 * List of the databases behind a PAW gateway — ANONYMOUS.
 *
 * The path is `/tm1/Servers` (TM1Proxy), not `/api/v1/tm1/Servers`: the
 * gateway carries `{ context: '/tm1', proxy: 'tm1:', allowAnonymousAccess: true }`
 * in its fixed route table, while the `/api/v1` route sits behind
 * `tm1v12Session()`. Measured against PAW Local 2.1.23 (2026-09-17):
 * `/tm1/Servers` anonymous `200` with `Name` + `AcceptingClients`,
 * `/api/v1/tm1/Servers` anonymous `401`. The login is only required by the
 * individual instance — exactly like with the TM1 admin server.
 *
 * PA SaaS answers the anonymous path with `401` (measured 2026-10-26); with
 * the cookies of a browser login, `/api/v1/tm1/Servers` lists its databases
 * (measured 2026-10-25). `cookie` takes that path.
 */
export function listPawInstances(
  baseUrl: string,
  rejectUnauthorized: boolean,
  timeoutMs = 10000,
  cookie?: string,
): Promise<PawInstance[]> {
  let normalized: string;
  try {
    normalized = normalizePawGatewayUrl(baseUrl);
  } catch (error) {
    return Promise.reject(error);
  }
  const parsed = new URL(`${normalized}${cookie ? '/api/v1' : ''}/tm1/Servers`);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise<PawInstance[]>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, result?: PawInstance[]): void => {
      if (settled) { return; }
      settled = true;
      clearTimeout(deadline);
      if (error !== undefined) { reject(error); } else { resolve(result ?? []); }
    };

    const req = transport.request({
      hostname: parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname,
      method: 'GET',
      headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(isHttps ? { rejectUnauthorized } : {}),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('aborted', () => finish(new PawGatewayError('PAW gateway response was aborted', 'response')));
      res.on('error', () => finish(new PawGatewayError('PAW gateway response failed', 'response')));
      res.on('end', () => {
        if (!res.complete) {
          finish(new PawGatewayError('PAW gateway response ended before it was complete', 'response'));
          return;
        }
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          finish(new PawGatewayError(`PAW gateway answered HTTP ${status} for ${parsed.pathname}`, 'http', status));
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        // PAW says "log in first" with a 200 (isPawAuthRequired): report it as
        // the 401 it means, so the caller offers the browser login.
        if (isPawAuthRequired(body)) {
          finish(new PawGatewayError(`PAW gateway requires a login for ${parsed.pathname}`, 'http', 401));
          return;
        }
        try {
          finish(undefined, parseInstances(body));
        } catch (error) {
          finish(error);
        }
      });
    });

    const deadline = setTimeout(() => {
      const error = new PawGatewayError(`PAW gateway request timed out after ${timeoutMs}ms`, 'timeout');
      req.destroy(error);
      finish(error);
    }, timeoutMs);
    req.on('error', (error) => finish(error));
    req.end();
  });
}
