// The PAW instance step of the browser login (review 2026-10-26): a refused
// instance must not come back as a login, and "Cancel" must stop it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', async (orig) => ({ ...(await orig<typeof import('child_process')>()), spawn }));
vi.mock('fs', async (orig) => ({ ...(await orig<typeof import('fs')>()), mkdirSync: () => undefined }));

import { browserLogin } from '../../tm1Rest/transport/browserLogin';

/** A browser that is on the login page first, then back on the gateway with one cookie. */
function fakeBrowser(silent = false): void {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdio: [null, null, null, toBrowser, fromBrowser], kill: () => undefined });
  let polls = 0;
  let buf = '';
  toBrowser.setEncoding('utf8');
  toBrowser.on('data', (chunk: string) => {
    buf += chunk;
    for (let i = buf.indexOf('\0'); i >= 0; i = buf.indexOf('\0')) {
      const { id, method } = JSON.parse(buf.slice(0, i)) as { id: number; method: string };
      buf = buf.slice(i + 1);
      if (silent) { continue; }
      const result = method === 'Target.getTargets'
        ? { targetInfos: [{ type: 'page', url: polls++ === 0 ? 'https://paw/login' : 'https://paw/' }] }
        : method === 'Storage.getCookies' ? { cookies: [{ name: 'paSession', value: 'gw', domain: 'paw' }] }
        : {};
      if (method === 'Browser.close') { setImmediate(() => child.emit('exit')); }
      fromBrowser.write(JSON.stringify({ id, result }) + '\0');
    }
  });
  spawn.mockReturnValue(child);
}

async function run(ready: () => Promise<boolean>, signal?: AbortSignal) {
  fakeBrowser();
  const p = browserLogin({
    startUrl: 'https://paw/', profileDir: '/x', browserPath: 'edge', timeoutMs: 60_000, signal,
    instanceLogin: { url: 'https://paw/login/tm1/A', ready },
  });
  await vi.advanceTimersByTimeAsync(70_000);
  return p;
}

afterEach(() => { vi.useRealTimers(); spawn.mockReset(); });

describe('browserLogin: PAW instance step', () => {
  it('data route never opens: timeout, not a login with the bare gateway cookie', async () => {
    vi.useFakeTimers();
    const outcome = await run(async () => false);
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('cancel during the instance step ends it as aborted', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const ready = vi.fn(async () => { abort.abort(); return false; });
    const outcome = await run(ready, abort.signal);
    expect(outcome).toMatchObject({ ok: false, reason: 'aborted' });
    // The first check (no instance step needed?) and nothing after the cancel.
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('data route opens: the cookies of that moment are the login', async () => {
    vi.useFakeTimers();
    let n = 0;
    const outcome = await run(async () => ++n > 2);
    expect(outcome).toEqual({ ok: true, cookie: 'paSession=gw' });
  });

  // Review 2026-10-25: a running browser that answers no CDP command held the
  // login forever — "Cancel" and the deadline are only checked between commands.
  it('a hung browser ends the login instead of holding it', async () => {
    vi.useFakeTimers();
    fakeBrowser(true);
    const p = browserLogin({ startUrl: 'https://paw/', profileDir: '/x', browserPath: 'edge', timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'failed' });
  });
});
