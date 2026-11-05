/**
 * Login through the user's own browser (IBMid / SAML / MFA), then REST with
 * that browser's cookies — no API key, no registered OAuth client. Measured
 * 2026-10-25 against PA SaaS and PAW Local; see browserLoginPure.ts.
 *
 * Edge or Chrome is driven over `--remote-debugging-pipe`: commands on fd 3,
 * replies on fd 4, each JSON message terminated by `\0`. No port is opened,
 * and no WebSocket is needed (Node 18 in VS Code ^1.85 has none built in).
 * A profile directory of our own is mandatory for remote debugging since
 * Chrome 136; the caller keeps it per server profile so the IdP remembers
 * the user.
 *
 * Until the login is done only `Target.getTargets` is sent — never a request
 * to the server (see the header of browserLoginPure.ts). Whether the cookies
 * actually carry (`ActiveUser` → 200) is the caller's check.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import type { Readable, Writable } from 'stream';
import {
  browserCandidates, cookieHeader, cookiesForHost, nextLoginState, type BrowserCookie,
} from './browserLoginPure';

export type BrowserLoginOutcome =
  | { ok: true; cookie: string }
  | { ok: false; reason: 'no-browser' | 'closed' | 'timeout' | 'aborted' | 'failed'; message: string };

export interface BrowserLoginOptions {
  /** Page to open: the SaaS host or the PAW gateway root. */
  startUrl: string;
  profileDir: string;
  signal?: AbortSignal;
  /** Login window; 5 min by default. */
  timeoutMs?: number;
  /** Overrides the search (tests, or a browser outside the fixed paths). */
  browserPath?: string;
  /** Diagnostics: page addresses (no query, it may carry IdP tokens) and
   *  cookie names (never values). */
  log?: (line: string) => void;
  /** PAW: after the gateway login, open this page in the same browser and
   *  wait until `ready` accepts the cookies — PAW logs in to the instance
   *  only there. */
  instanceLogin?: { url: string; ready: (cookie: string) => Promise<boolean> };
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 1000;
/** A browser that does not answer a CDP command within this is taken as hung. */
const CDP_REPLY_MS = 10_000;
/** How long cleanup waits for the browser to close before it is killed. */
const CLOSE_MS = 3000;

export function findBrowser(): string | undefined {
  return browserCandidates(process.platform, process.env).find(p => fs.existsSync(p));
}

interface CdpPipe {
  send<T>(method: string, params?: object): Promise<T>;
  close(): void;
}

function cdpPipe(child: ChildProcess): CdpPipe {
  const out = child.stdio[3] as Writable;
  const inp = child.stdio[4] as Readable;
  let id = 0;
  let buf = '';
  const pending = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  // setEncoding decodes across chunk borders; a plain `buf += chunk` would
  // split multi-byte characters.
  inp.setEncoding('utf8');
  inp.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)) as { id?: number; result?: unknown; error?: { message: string } };
      buf = buf.slice(i + 1);
      const p = msg.id === undefined ? undefined : pending.get(msg.id);
      if (!p) { continue; }
      pending.delete(msg.id!);
      if (msg.error) { p.rej(new Error(msg.error.message)); } else { p.res(msg.result); }
    }
  });
  const failAll = (): void => {
    for (const p of pending.values()) { p.rej(new Error('Browser connection closed')); }
    pending.clear();
  };
  inp.on('close', failAll);
  out.on('error', failAll);
  return {
    // Bounded: an unanswered command held the login past "Cancel" and the
    // deadline, both of which are only checked between commands (review 2026-10-25).
    send: <T>(method: string, params: object = {}) => new Promise<T>((res, rej) => {
      const i = ++id;
      const timer = setTimeout(() => { pending.delete(i); rej(new Error(`Browser did not answer ${method}`)); }, CDP_REPLY_MS);
      pending.set(i, {
        res: v => { clearTimeout(timer); (res as (v: unknown) => void)(v); },
        rej: e => { clearTimeout(timer); rej(e); },
      });
      out.write(JSON.stringify({ id: i, method, params }) + '\0');
    }),
    close: () => { out.end(); inp.destroy(); },
  };
}

export async function browserLogin(opts: BrowserLoginOptions): Promise<BrowserLoginOutcome> {
  const exe = opts.browserPath ?? findBrowser();
  if (!exe) {
    return { ok: false, reason: 'no-browser', message: 'No Microsoft Edge or Google Chrome found.' };
  }
  const target = new URL(opts.startUrl);
  fs.mkdirSync(opts.profileDir, { recursive: true });

  const child = spawn(exe, [
    `--user-data-dir=${opts.profileDir}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-logging=stderr',
    target.href,
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

  // Kept for the log only: a browser that quits at once (e.g. the debugging
  // pipe did not arrive) says why on stderr and nowhere else.
  let stderrTail = '';
  const stderr = child.stdio[2] as Readable | null;
  stderr?.setEncoding('utf8');
  stderr?.on('data', (s: string) => { stderrTail = (stderrTail + s).slice(-2000); });
  let exited = false;
  let exitInfo = '';
  const exitedP = new Promise<void>(res => child.once('exit', (code: number | null, signal: string | null) => {
    exited = true; exitInfo = `exit code ${code ?? '-'}${signal ? `, signal ${signal}` : ''}`; res();
  }));
  const spawnErr = new Promise<Error>(res => child.once('error', res));
  const cdp = cdpPipe(child);
  const deadline = Date.now() + (opts.timeoutMs ?? LOGIN_TIMEOUT_MS);

  const finish = async (outcome: BrowserLoginOutcome): Promise<BrowserLoginOutcome> => {
    if (!exited) {
      await Promise.race([cdp.send('Browser.close').catch(() => undefined), exitedP,
        new Promise(res => setTimeout(res, CLOSE_MS))]);
      if (!exited) { child.kill(); }
    }
    cdp.close();
    return outcome;
  };

  const log = opts.log ?? ((): void => undefined);
  log(`Browser: ${exe}, start page ${target.origin}${target.pathname}`);
  let lastPage = '';
  let state = { sawLogin: false };
  for (;;) {
    if (opts.signal?.aborted) { return finish({ ok: false, reason: 'aborted', message: 'Browser login cancelled.' }); }
    if (Date.now() > deadline) { return finish({ ok: false, reason: 'timeout', message: 'Browser login timed out.' }); }

    const tick = new Promise<void>(res => setTimeout(res, POLL_MS));
    const raced = await Promise.race([
      tick.then(() => 'tick' as const),
      exitedP.then(() => 'exit' as const),
      spawnErr.then(e => e),
    ]);
    if (raced instanceof Error) {
      return finish({ ok: false, reason: 'failed', message: `Could not start the browser: ${raced.message}` });
    }
    if (raced === 'exit') {
      log(`Browser exited (${exitInfo})${stderrTail.trim() ? `. Last output:\n${stderrTail.trim()}` : ''}`);
      // No page ever seen: the browser did not come up, nobody closed it.
      if (!lastPage) {
        return finish({ ok: false, reason: 'failed', message: `The browser exited right after start (${exitInfo}). See the "TM1 Browser Login" output.` });
      }
      return finish({ ok: false, reason: 'closed', message: 'The browser was closed before the login finished.' });
    }

    let pages: string[];
    try {
      const { targetInfos } = await cdp.send<{ targetInfos: Array<{ type: string; url: string }> }>('Target.getTargets');
      pages = targetInfos.filter(t => t.type === 'page').map(t => t.url);
    } catch (e) {
      if (exited) { continue; }
      return finish({ ok: false, reason: 'failed', message: `Browser did not answer: ${(e as Error).message}` });
    }
    // The first page is the one we opened; a popup the IdP opens comes later.
    if (pages.length === 0) { continue; }
    const page = pageForLog(pages[0]);
    if (page !== lastPage) { log(`Page: ${page}`); lastPage = page; }
    const next = nextLoginState(state, pages[0], target.origin);
    state = next;
    if (!next.done) { continue; }

    try {
      const { cookies } = await cdp.send<{ cookies: BrowserCookie[] }>('Storage.getCookies');
      const header = cookieHeader(cookiesForHost(cookies, target.hostname));
      log(`Back on ${target.hostname}. Cookies (name @ domain): ${cookies.map(c => `${c.name} @ ${c.domain}`).join(', ') || 'none'}`);
      if (!header) { continue; }
      if (!opts.instanceLogin) { return finish({ ok: true, cookie: header }); }
      return finish(await loginToInstance(cdp, opts.instanceLogin, target.hostname, header, deadline, log, opts.signal));
    } catch (e) {
      return finish({ ok: false, reason: 'failed', message: `Could not read the browser cookies: ${(e as Error).message}` });
    }
  }
}

/**
 * Measured on a company PAW (2026-09-30, integratedSession.ts; again
 * 2026-10-25 with the browser cookies): data calls answer 401 with
 * `authenticate.location: "/login/tm1/<instance>"` until that page has run.
 * The browser does the instance's own login there (Windows SSO included).
 * Neither a cookie nor the page tells when it is done — on 2026-10-25 the
 * page kept loading and `TM1SessionId_<instance>` did not show within 60 s,
 * yet the next connect was logged in. So the data route itself is asked.
 */
async function loginToInstance(
  cdp: CdpPipe, step: { url: string; ready: (cookie: string) => Promise<boolean> }, host: string,
  header: string, deadline: number, log: (line: string) => void, signal?: AbortSignal,
): Promise<BrowserLoginOutcome> {
  // PAW Local needs no instance step: the gateway cookies carry already.
  if (await step.ready(header)) { log('Instance login: not needed'); return { ok: true, cookie: header }; }
  log(`Instance login: ${pageForLog(step.url)}`);
  await cdp.send('Target.createTarget', { url: step.url });
  for (let n = 1; Date.now() < deadline; n++) {
    await new Promise(res => setTimeout(res, 2 * POLL_MS));
    if (signal?.aborted) { return { ok: false, reason: 'aborted', message: 'Browser login cancelled.' }; }
    const { cookies } = await cdp.send<{ cookies: BrowserCookie[] }>('Storage.getCookies');
    const now = cookieHeader(cookiesForHost(cookies, host));
    if (await step.ready(now)) { log(`Instance login done after ${2 * n} s`); return { ok: true, cookie: now }; }
  }
  // The gateway cookies alone do not open the instance: no session to keep.
  log('Instance login: data route still refused at the deadline');
  return { ok: false, reason: 'timeout', message: 'Instance login timed out.' };
}

function pageForLog(url: string): string {
  try { const u = new URL(url); return u.protocol.startsWith('http') ? u.origin + u.pathname : url; } catch { return url; }
}
