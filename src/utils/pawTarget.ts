// PAW helpers without imports: the add-server webview uses them too.
/**
 * `https://<paw>/api/v1/tm1/<instance>` or, with a tenant,
 * `https://<paw>/api/<tenant>/v0/tm1/<instance>` → gateway and instance,
 * otherwise `undefined` (a direct TM1 URL). See the PAW section in the
 * header of `tm1Rest/transport/integratedSession.ts`.
 */
export function pawTarget(serverUrl: string): { gateway: string; instance: string } | undefined {
  const m = /^(https?:\/\/[^/]+(?:\/.*?)?)\/api\/(?:v1|[^/?#]+\/v0)\/tm1\/([^/?#]+)\/?$/i.exec(serverUrl.trim());
  return m ? { gateway: m[1], instance: m[2] } : undefined;
}

/**
 * PAW's "log in first" answer. Measured 2026-10-31 on a company PAW with
 * `Accept: application/json`: `/tm1/Servers` and `/api/v1/Servers` both
 * answer **200** with
 * `{"error":{"code":"AUTH_REQUIRED","message":{"authenticate":{"location":"/login"}}},…}`
 * — no 401, no challenge. Without `Accept` the body is an HTML page that
 * redirects to `/login` by script, also 200.
 */
export function isPawAuthRequired(body: string): boolean {
  return /"code"\s*:\s*"AUTH_REQUIRED"/.test(body);
}

/**
 * Instance URL behind a gateway root: `<gateway>/api/v1/tm1/<name>`, or with a
 * tenant the PA SaaS shape `<gateway>/api/<tenant>/v0/tm1/<name>`. `name` goes
 * in already encoded; the inverse is `pawTarget`.
 */
export function pawInstanceRoute(gateway: string, encodedName: string, tenant?: string): string {
  const route = tenant ? `api/${encodeURIComponent(tenant)}/v0` : 'api/v1';
  return `${gateway}/${route}/tm1/${encodedName}`;
}
