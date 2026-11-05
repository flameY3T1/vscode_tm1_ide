// Browser login on explicit connect (plan 2026-10-25, step 4). The transport
// never logs in by itself (http.ts answers 401 without a session); this is the
// only place that opens the browser and puts its cookies into the session
// cache. The caller's usual probe (`Configuration`) then checks they carry.
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { browserLogin, type BrowserLoginOutcome } from '../../tm1Rest/transport/browserLogin';
import { pawTarget } from '../../utils/pawTarget';
import { resolveAgent } from '../../tm1Rest/transport/agent';
import { _allSessions, _clearAuthFailed, _getSession, _setSession } from '../../tm1Rest/transport/session';
import { request, _rawRequest } from '../../tm1Rest/transport/http';
import { buildBaseUrl } from '../../tm1Rest/transport/urlBuilder';
import { parseBody } from '../../tm1Rest/parseRest';
import { getExtensionContext } from '../../utils/extensionContext';
import { outputChannel } from '../../utils/outputChannel';
import type { Tm1Config } from '../../tm1Rest/transport/types';

/** The page the browser opens: the SaaS host or the PAW gateway root. */
function startUrl(cfg: Tm1Config): string {
  const paw = cfg.version === 'v12' ? undefined : pawTarget(cfg.serverUrl);
  return `${(paw ? paw.gateway : cfg.serverUrl).replace(/\/+$/, '')}/`;
}

const originOf = (url: string): string => new URL(url).origin;

/**
 * One browser profile per host (SaaS region host or PAW gateway), kept between
 * logins so the IdP remembers the user. The login covers the whole host, not
 * one database: measured 2026-10-25, the same cookies list and open every
 * database behind it (`/api/v1/tm1/Servers`).
 */
function profileDir(serverUrl: string): string {
  const id = crypto.createHash('sha256').update(originOf(serverUrl)).digest('hex').slice(0, 16);
  const root = getExtensionContext()?.globalStorageUri.fsPath ?? path.join(os.tmpdir(), 'vscode-tm1-ide');
  return path.join(root, 'browser', id);
}

/**
 * Deletes the browser profile of a host, and with it the IdP session Chrome
 * keeps on disk. Call once no remaining server profile logs in to that host
 * by browser.
 */
export async function removeBrowserProfile(serverUrl: string): Promise<void> {
  await fs.rm(profileDir(serverUrl), { recursive: true, force: true });
}

function failureText(outcome: Extract<BrowserLoginOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'no-browser': return vscode.l10n.t('Browser login needs Microsoft Edge or Google Chrome, and neither was found.');
    case 'closed':     return vscode.l10n.t('The browser was closed before the login finished.');
    case 'timeout':    return vscode.l10n.t('The browser login was not finished within 5 minutes.');
    case 'aborted':    return vscode.l10n.t('The browser login was cancelled.');
    case 'failed':     return vscode.l10n.t('The browser login failed: {0}', outcome.message);
  }
}

/** PAW instance: the cookie its own login step sets (browserLogin.ts#loginToInstance). */
function instanceCookie(cfg: Tm1Config): string | undefined {
  const paw = cfg.version === 'v12' ? undefined : pawTarget(cfg.serverUrl);
  return paw ? `TM1SessionId_${decodeURIComponent(paw.instance)}` : undefined;
}

/**
 * The host's cookies carry this profile. A PAW instance may need its own
 * login step, and no cookie tells whether it ran (browserLogin.ts#loginToInstance),
 * so the data route itself is asked — a remembered "done" outlived its
 * session and handed another instance's cookies over unchecked (review 2026-10-26).
 */
async function fits(cfg: Tm1Config, cookie: string): Promise<boolean> {
  const name = instanceCookie(cfg)?.toLowerCase();
  return !name || cookie.toLowerCase().split('; ').some(c => c.startsWith(name + '=')) || carries(cfg, cookie);
}

/** Cookies of a live browser session on the same host — a second database needs no second login. */
async function hostCookie(cfg: Tm1Config): Promise<string | undefined> {
  const origin = originOf(cfg.serverUrl);
  for (const e of _allSessions()) {
    if (e.cfg.authType === 'browser' && originOf(e.cfg.serverUrl) === origin && _getSession(e.cfg)
      && await fits(cfg, e.cookie)) { return e.cookie; }
  }
  return undefined;
}

/**
 * For `browser` profiles without a live session: reuse the host's session or
 * log in through the browser, and cache the cookies. Every other profile
 * passes through untouched.
 * Throws with a user-facing message when the login does not finish.
 */
export async function ensureBrowserSession(cfg: Tm1Config): Promise<void> {
  if (cfg.authType !== 'browser' || _getSession(cfg)) { return; }
  const isHttps = new URL(cfg.serverUrl).protocol === 'https:';
  const shared = await hostCookie(cfg);
  if (shared) {
    _setSession(cfg, { cookie: shared, agent: resolveAgent(cfg, isHttps), cfg, lastUsed: Date.now() });
    _clearAuthFailed(cfg);
    return;
  }
  // The extension host must run where the browser runs (plan, decision 7).
  if (vscode.env.remoteName) {
    throw new Error(vscode.l10n.t('Browser login only works in a local VS Code window, not in a remote one ({0}).', vscode.env.remoteName));
  }
  // One login per host at a time: a second browser on the same profile
  // directory hands its URL to the running one and exits at once, which
  // read as "closed before the login finished".
  // A PAW login for another instance does not carry this one: then log in
  // again once it is done.
  const origin = originOf(cfg.serverUrl);
  let cookie: string | undefined;
  for (let running = loginInflight.get(origin); running; running = loginInflight.get(origin)) {
    cookie = await running;
  }
  if (cookie === undefined || !(await fits(cfg, cookie))) {
    const login = loginOnce(cfg).finally(() => loginInflight.delete(origin));
    loginInflight.set(origin, login);
    cookie = await login;
  }
  _setSession(cfg, { cookie, agent: resolveAgent(cfg, isHttps), cfg, lastUsed: Date.now() });
  // A 401 on the expired cookies left the guard set (http.ts); with fresh
  // cookies it would refuse every call before the network (review 2026-10-25).
  _clearAuthFailed(cfg);
}

const loginInflight = new Map<string, Promise<string>>();

/** The cookies open the instance's data route (`Configuration` → 200). */
async function carries(cfg: Tm1Config, cookie: string): Promise<boolean> {
  const isHttps = new URL(cfg.serverUrl).protocol === 'https:';
  try {
    const res = await _rawRequest('GET', `${buildBaseUrl(cfg)}/Configuration?$select=ProductVersion`, cfg,
      undefined, 15_000, undefined, cookie, resolveAgent(cfg, isHttps));
    return res.statusCode === 200;
  } catch { return false; }
}

async function loginOnce(cfg: Tm1Config): Promise<string> {
  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Log in to TM1 in the browser window that just opened…'),
      cancellable: true,
    },
    (_progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const out = outputChannel('TM1 Browser Login');
      const paw = cfg.version === 'v12' ? undefined : pawTarget(cfg.serverUrl);
      return browserLogin({
        startUrl: startUrl(cfg), profileDir: profileDir(cfg.serverUrl), signal: abort.signal, log: l => out.info(l),
        instanceLogin: paw ? { url: `${paw.gateway}/login/tm1/${paw.instance}`, ready: c => carries(cfg, c) } : undefined,
      });
    },
  );
  if (!outcome.ok) { throw new Error(failureText(outcome)); }
  return outcome.cookie;
}

export interface SaasLists {
  tenants: { id: string; name: string }[];
  databases: string[];
}

/**
 * PA SaaS: log in on the region host alone and list what the form can offer.
 * Measured 2026-10-25 with the browser cookies: tenants from
 * `/rolemgmt/v1/users/me/environments` (`[{id, name, …}]`), databases from
 * `/api/v1/tm1/Servers` (`{value: [{Name, …}]}`). The session lands in the
 * cache under the bare host, so the connect right after reuses it.
 */
export async function loadSaasLists(serverUrl: string, rejectUnauthorized: boolean): Promise<SaasLists> {
  const origin = originOf(serverUrl);
  const cfg: Tm1Config = { serverUrl: origin, username: '', password: '', rejectUnauthorized, authType: 'browser' };
  await ensureBrowserSession(cfg);
  const get = async <T>(p: string): Promise<T> => {
    const res = await request('GET', origin + p, cfg);
    if (res.statusCode !== 200) { throw new Error(vscode.l10n.t('{0} answered HTTP {1}.', p, String(res.statusCode))); }
    return parseBody<T>(res);
  };
  const [envs, servers] = await Promise.all([
    // Tenants exist on PA SaaS; a PAW Local gateway may have none (route NOT
    // measured there) — then the list is simply empty.
    get<{ id: string; name: string }[]>('/rolemgmt/v1/users/me/environments').catch(() => []),
    get<{ value: { Name: string }[] }>('/api/v1/tm1/Servers'),
  ]);
  return {
    tenants: envs.map(e => ({ id: e.id, name: e.name })),
    databases: servers.value.map(s => s.Name),
  };
}
