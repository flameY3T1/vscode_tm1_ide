/** Pure proxy resolution — no vscode / http / https imports. */

const ALWAYS_BYPASS = new Set(['localhost', '127.0.0.1', '::1']);

/** Strip surrounding brackets from an IPv6-literal host (`[::1]` -> `::1`). */
function stripBrackets(host: string): string {
  return host.replace(/^\[|\]$/g, '');
}

/** True if the target host:port should bypass the proxy (connect directly). */
export function noProxyMatches(host: string, port: number, noProxy: string[]): boolean {
  const h = stripBrackets(host.toLowerCase());
  if (ALWAYS_BYPASS.has(h)) { return true; }
  for (const raw of noProxy) {
    const entry = raw.trim().toLowerCase();
    if (!entry) { continue; }
    if (entry === '*') { return true; }
    let ePat = entry;
    let ePort: number | undefined;
    if (entry.startsWith('[')) {
      // [ipv6] or [ipv6]:port
      const close = entry.indexOf(']');
      if (close > 0) {
        ePat = entry.slice(1, close);
        const pm = /^:(\d+)$/.exec(entry.slice(close + 1));
        if (pm) { ePort = parseInt(pm[1], 10); }
      }
    } else {
      // Only treat as host:port when there is EXACTLY ONE colon — avoids
      // splitting bare IPv6 literals like `fe80::1` (multiple colons).
      const colon = entry.indexOf(':');
      if (colon > 0 && entry.indexOf(':', colon + 1) === -1 && /^\d+$/.test(entry.slice(colon + 1))) {
        ePort = parseInt(entry.slice(colon + 1), 10);
        ePat = entry.slice(0, colon);
      }
    }
    if (ePort !== undefined && ePort !== port) { continue; }
    const suffix = ePat.replace(/^\*?\./, '');
    if (h === suffix) { return true; }
    if (h.endsWith('.' + suffix)) { return true; }
  }
  return false;
}

export interface ProxyEnv { [k: string]: string | undefined }
export interface ProxySettings { proxy?: string; proxyStrictSSL?: boolean; noProxy?: string[] }
export interface ProxyDecision { mode: 'direct' | 'proxy'; proxyUrl?: string; strictSSL: boolean }

function envProxy(env: ProxyEnv): string | undefined {
  return env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
}
function envNoProxy(env: ProxyEnv): string[] {
  const v = env.NO_PROXY ?? env.no_proxy ?? '';
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

export function resolveProxy(targetUrl: string, env: ProxyEnv, settings: ProxySettings): ProxyDecision {
  const strictSSL = settings.proxyStrictSSL !== false;
  const proxyUrl = (settings.proxy && settings.proxy.trim()) || envProxy(env);
  if (!proxyUrl) { return { mode: 'direct', strictSSL }; }

  let host = '', port = 0;
  try {
    const u = new URL(targetUrl);
    host = u.hostname;
    port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return { mode: 'direct', strictSSL };
  }
  const noProxy = [...(settings.noProxy ?? []), ...envNoProxy(env)];
  if (noProxyMatches(host, port, noProxy)) { return { mode: 'direct', strictSSL }; }
  return { mode: 'proxy', proxyUrl, strictSSL };
}
