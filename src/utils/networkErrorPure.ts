/**
 * Classifies the network error of a connection attempt — pure, without
 * `vscode` (depcruise `pure-no-vscode`). The caller formulates the sentences
 * for it.
 *
 * The trigger was `'scheme'`: `https://` against a port that only speaks
 * plain HTTP arrives at the user as
 *
 *   write EPROTO … SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER
 *   … third_party\boringssl\src\ssl\tls_record.cc:127
 *
 * That reads like "TLS version mismatch" and is the opposite: we sent a
 * ClientHello, the other side answered in plain text (`HTTP/1.1 400 …`),
 * BoringSSL reads the first bytes as a TLS record header and finds ASCII in
 * the version field. The diagnosis is unambiguous — **the port doesn't speak
 * TLS at all** — only the message doesn't say so.
 *
 * Two paths hinged on this: the raw text reached the user uninterpreted, and
 * the scheme fallback in `probeWithFallback` only kicked in on
 * `ECONNREFUSED`, so it missed exactly the case it was built for.
 */

export type NetErrorKind = 'dns' | 'refused' | 'timeout' | 'tls' | 'scheme' | 'other';

interface NetErrorLike { code?: string; message?: string; tlsCert?: boolean }

/** Certificate error — the other side speaks TLS, we don't trust it. */
export function isTlsCertError(err: unknown): boolean {
  if (!err) { return false; }
  const e = err as NetErrorLike;
  if (e.tlsCert) { return true; }
  return /certificate|self.signed|CERT_/i.test((e.code ?? '') + (e.message ?? String(err)));
}

/**
 * The other side doesn't speak TLS AT ALL on this port.
 *
 * `EPROTO` alone isn't enough as a marker — Node uses the code for other
 * protocol errors too. What's decisive is the OpenSSL/BoringSSL reason in the
 * text; both spellings occur (`WRONG_VERSION_NUMBER` for BoringSSL in
 * Electron, `wrong version number` for OpenSSL in Node).
 */
export function isPlainHttpPortError(err: unknown): boolean {
  if (!err) { return false; }
  const e = err as NetErrorLike;
  const text = (e.code ?? '') + ' ' + (e.message ?? String(err));
  if (/wrong[_ ]version[_ ]number/i.test(text)) { return true; }
  // `packet length too long` is the same situation, just seen from the other
  // side: the plain-text response is so long that even the length field of
  // the supposed record becomes nonsensical.
  return e.code === 'EPROTO' && /packet length too long|record layer/i.test(text);
}

/**
 * The mirror image: `http://` against a port that only speaks TLS. Node's
 * HTTP parser gets TLS alert bytes instead of a status line (measured
 * 2026-10-30 against 11.8: `HPE_INVALID_CONSTANT`, "Parse Error: Expected
 * HTTP/, RTSP/ or ICE/"). Until then it landed in `'other'` and the scheme
 * fallback never ran, although switching to https is not a downgrade.
 */
export function isTlsOnlyPortError(err: unknown): boolean {
  if (!err) { return false; }
  const e = err as NetErrorLike;
  return e.code === 'HPE_INVALID_CONSTANT' || /Expected HTTP\//.test(e.message ?? String(err));
}

export function classifyNetworkError(err: unknown): NetErrorKind {
  const e = (err ?? {}) as NetErrorLike;
  const code = e.code ?? '';
  const msg = e.message ?? String(err ?? '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') { return 'dns'; }
  if (code === 'ECONNREFUSED') { return 'refused'; }
  if (code === 'ETIMEDOUT' || /timeout/i.test(msg)) { return 'timeout'; }
  // BEFORE the certificate check: the text of a WRONG_VERSION_NUMBER message
  // contains "SSL routines", which the loose certificate check would
  // otherwise match.
  if (isPlainHttpPortError(err) || isTlsOnlyPortError(err)) { return 'scheme'; }
  if (isTlsCertError(err)) { return 'tls'; }
  return 'other';
}

/** Swaps `http` for `https` and vice versa; `null` for anything else. */
export function swapScheme(url: string): string | null {
  if (/^https:\/\//i.test(url)) { return url.replace(/^https:/i, 'http:'); }
  if (/^http:\/\//i.test(url)) { return url.replace(/^http:/i, 'https:'); }
  return null;
}

/** The host from a URL, or the URL itself if it doesn't parse. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
