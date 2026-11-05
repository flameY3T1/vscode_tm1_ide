/**
 * The pure parts of the browser login (see browserLogin.ts): where to find a
 * browser, when the login counts as done, which cookies to keep.
 *
 * Measured 2026-10-25 (probe saasBrowserCookieProbe.js):
 * - PA SaaS leaves the PA host for IBMid and comes back on `<host>/`.
 * - PAW Local 2.1.23 (`PAAuthMode=tm1`) shows its own `<paw>/login` page on
 *   the same host.
 * - Either way the PA host sets a `paSession` BEFORE the login. Sending it
 *   from a second client while the page still sits on the host broke the SaaS
 *   login in 2 of 4 runs. So nothing talks to the server until the page has
 *   been through a login page and come back.
 */

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
}

/** Edge first, then Chrome, then Chromium — fixed install paths per OS. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r);
    return [
      ...roots.map(r => `${r}\\Microsoft\\Edge\\Application\\msedge.exe`),
      ...roots.map(r => `${r}\\Google\\Chrome\\Application\\chrome.exe`),
    ];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

const LOGIN_PATH = /login|auth|oidc|saml/i;

/**
 * Follows the page URL. `sawLogin` turns true once the page is off the target
 * host (IdP) or on a login path of it; `done` once it is back on the target
 * host outside a login path after that.
 *
 * A remembered IdP session in the kept profile still redirects through the
 * IdP, and PAW's `paSession` is a session cookie that dies with the browser —
 * so a second login shows a login page as well and `done` is reached.
 */
export function nextLoginState(
  state: { sawLogin: boolean },
  pageUrl: string,
  targetOrigin: string,
): { sawLogin: boolean; done: boolean } {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return { sawLogin: state.sawLogin, done: false }; }
  // `about:blank` and friends: the page has not loaded anything yet.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') { return { sawLogin: state.sawLogin, done: false }; }
  const onTarget = url.origin === targetOrigin;
  const onLoginPath = LOGIN_PATH.test(url.pathname);
  const sawLogin = state.sawLogin || !onTarget || onLoginPath;
  return { sawLogin, done: sawLogin && onTarget && !onLoginPath };
}

/**
 * Every cookie the browser would send to `host` — all of them, not a name
 * list: behind PAW v11 the instance cookie is `TM1SessionId_<instance>`, on
 * SaaS the Akamai cookies ride along.
 */
export function cookiesForHost(cookies: readonly BrowserCookie[], host: string): BrowserCookie[] {
  const h = host.toLowerCase();
  return cookies.filter(c => {
    const d = c.domain.toLowerCase();
    if (d.startsWith('.')) { return h === d.slice(1) || h.endsWith(d); }
    return h === d;
  });
}

export function cookieHeader(cookies: readonly BrowserCookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}
