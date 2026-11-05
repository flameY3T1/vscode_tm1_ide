/**
 * Which login a TM1 v11 server accepts, read from the `WWW-Authenticate`
 * lines of an UNAUTHENTICATED request. No username is sent, so the probe does
 * not count against `MaximumLoginAttempts`.
 *
 * Measured 2026-10-09:
 * - v11.8, mode 1: `Basic realm="TM1"`.
 * - v12 (basic-s2s): 401 without any `WWW-Authenticate` — nothing to read.
 * - PAW gateway (2026-09-17, see ntlm.ts): `Bearer`, `Negotiate` and `Basic`
 *   at once — a list, not a single answer.
 * NOT measured: the CAM answer (mode 4/5). IBM documents a scheme carrying the
 * Cognos address; any scheme starting with `CAM` is taken as CAM.
 */
export type OfferedLogin = 'Basic' | 'CAM' | 'integrated';

export function offeredLogins(challenges: readonly string[]): OfferedLogin[] {
  const out = new Set<OfferedLogin>();
  // One line can carry several schemes, comma-separated; parameters
  // (`realm="TM1"`) sit behind the first blank.
  for (const part of challenges.flatMap(c => c.split(','))) {
    const scheme = part.trim().split(/\s+/, 1)[0].toLowerCase();
    if (scheme === 'basic') { out.add('Basic'); }
    else if (scheme.startsWith('cam')) { out.add('CAM'); }
    else if (scheme === 'negotiate' || scheme === 'ntlm') { out.add('integrated'); }
  }
  return [...out];
}

/**
 * The logins the server offers when the chosen one is NOT among them;
 * `undefined` when it is, or when the server names none (nothing to say).
 */
export function loginMismatch(chosen: OfferedLogin, offered: readonly OfferedLogin[]): OfferedLogin[] | undefined {
  if (offered.length === 0 || offered.includes(chosen)) { return undefined; }
  return [...offered];
}
