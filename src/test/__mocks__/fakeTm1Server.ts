import * as http from 'http';
import type { AddressInfo } from 'net';
import type { Tm1Config } from '../../tm1Client';

export interface FakeTm1 {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

export type FakeHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Spins up an in-process HTTP server bound to a random localhost port.
 * Test code passes `behavior` to script per-request responses.
 */
export function startFakeTm1(behavior: FakeHandler): Promise<FakeTm1> {
  return new Promise((resolve) => {
    const server = http.createServer(behavior);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/** Default Basic-Auth config pointed at a fake server URL. */
export function fakeConfig(serverUrl: string, overrides: Partial<Tm1Config> = {}): Tm1Config {
  return {
    serverUrl,
    username: 'admin',
    password: 'apple',
    rejectUnauthorized: false,
    authType: 'Basic',
    ...overrides,
  } as Tm1Config;
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
