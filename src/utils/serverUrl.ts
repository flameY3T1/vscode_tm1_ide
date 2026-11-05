/**
 * Pure validator for TM1 server URLs entered via the Server Manager.
 *
 * Returns `null` when the value is acceptable, otherwise a human-readable
 * error message suitable for `showInputBox({ ignoreFocusOut: true, validateInput })`.
 */
export function validateServerUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) { return 'URL must not be empty.'; }
  if (v.length > 512) { return 'URL is too long (max. 512 characters).'; }
  if (/[\x00-\x1f\x7f]/.test(v)) { return 'URL contains control characters.'; }
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return 'Invalid URL (e.g. https://host:8010).';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Scheme "${parsed.protocol}" not allowed — only http:// or https://.`;
  }
  if (parsed.username || parsed.password) {
    return 'URL must not contain credentials (user:pass@host).';
  }
  return null;
}

/** Returns true if the URL uses plain HTTP (credentials would be sent in cleartext over the wire). */
export function isPlainHttpUrl(raw: string): boolean {
  try {
    return new URL(raw.trim()).protocol === 'http:';
  } catch {
    return false;
  }
}

/** Normalizes a server URL by adding https:// if missing and removing trailing slashes. */
export function normalizeServerUrl(raw: string): string {
  const v = raw.trim();
  if (!v) { return ''; }
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  const m = /^(https?:\/\/)(.*)$/i.exec(withScheme);
  // Strip any userinfo (user:pass@) so credentials never get persisted in plaintext.
  const stripUserinfo = (rest: string): string => rest.replace(/^[^/@]*@/, '');
  return m ? m[1] + stripUserinfo(m[2]).replace(/\/+$/, '') : withScheme.replace(/\/+$/, '');
}

/**
 * PA as a Service region host (`<region>.planninganalytics.saas.ibm.com`).
 * Users looking for SaaS do not think "v12": on such a URL the form switches
 * itself to v12 with browser login.
 */
export function isSaasHost(url: string): boolean {
  try { return /\.planninganalytics\.saas\.ibm\.com$/i.test(new URL(url).hostname); } catch { return false; }
}
