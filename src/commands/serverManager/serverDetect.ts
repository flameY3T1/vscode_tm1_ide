// Type detection for the add-server form: anonymous requests only, so a wrong
// guess never costs a login attempt (the 2026-10-30 fault matrix locked the
// test user out through exactly those attempts).
import { anonymousGet, type AnonAnswer } from '../../tm1Rest/anonymousGet';
import { classifyNetworkError, swapScheme } from '../../utils/networkErrorPure';
import { describeNetworkError } from '../../utils/networkErrorText';
import { isSaasHost, normalizeServerUrl, validateServerUrl } from '../../utils/serverUrl';
import { classifyServersAnswer, parseServerAddress, pawBehindLogin, pawChallenge, pawFrom } from './serverDetectPure';
// The wire contract IS the result: one shape, no mirror to keep in step.
import type { DetectResultData as DetectResult } from '../../webviewClient/addServer/protocol';

const DETECT_TIMEOUT_MS = 8_000;
/** The PAW path is a bonus (the database list). Cut to 3 s on 2026-10-31 on
 *  the reading "a company PAW never answers it for Node"; that reading was
 *  wrong (2026-11-01: curl.exe 200 in < 0.3 s, the first request after VS Code
 *  starts is what hangs, a second one answers). Back to the detection budget,
 *  so a slow first answer still fills the list. */
const PAW_LIST_TIMEOUT_MS = DETECT_TIMEOUT_MS;

async function ask(origin: string, rejectUnauthorized: boolean): Promise<{ servers: AnonAnswer; paw?: AnonAnswer }> {
  // In parallel: one round trip. A failed PAW path must not hide the answer
  // that classifies everything else.
  const [servers, paw] = await Promise.all([
    anonymousGet(`${origin}/api/v1/Servers`, rejectUnauthorized, DETECT_TIMEOUT_MS),
    anonymousGet(`${origin}/tm1/Servers`, rejectUnauthorized, PAW_LIST_TIMEOUT_MS).catch(() => undefined),
  ]);
  return { servers, paw };
}

/** One origin, retried once on the other scheme and once without
 *  certificate verification — both safe here, nothing secret is sent. */
async function askWithFallback(origin: string, rejectUnauthorized: boolean) {
  const tries: { origin: string; rejectUnauthorized: boolean }[] = [{ origin, rejectUnauthorized }];
  let firstErr: unknown;
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    try {
      return { ...t, answers: await ask(t.origin, t.rejectUnauthorized) };
    } catch (err) {
      firstErr ??= err;
      const kind = classifyNetworkError(err);
      if (kind === 'tls' && t.rejectUnauthorized) { tries.push({ ...t, rejectUnauthorized: false }); }
      const swapped = swapScheme(t.origin);
      if ((kind === 'scheme' || kind === 'refused') && swapped && i === 0) { tries.push({ origin: swapped, rejectUnauthorized: t.rejectUnauthorized }); }
    }
  }
  throw firstErr;
}

export async function detectServer(rawUrl: string, rejectUnauthorized: boolean): Promise<DetectResult> {
  const url = normalizeServerUrl(rawUrl);
  const urlError = validateServerUrl(url);
  if (urlError) { return { ok: false, message: urlError }; }
  const parsed = parseServerAddress(url);
  if (isSaasHost(url)) {
    return { ok: true, kind: 'saas', serverUrl: parsed.origin, ...(parsed.saas ? { saas: parsed.saas } : {}) };
  }
  let hit: Awaited<ReturnType<typeof askWithFallback>>;
  try {
    hit = await askWithFallback(parsed.origin, rejectUnauthorized);
  } catch (err) {
    return { ok: false, message: describeNetworkError(err, url) };
  }
  const base = {
    ok: true,
    serverUrl: hit.origin,
    ...(hit.rejectUnauthorized !== rejectUnauthorized ? { certUntrusted: true } : {}),
  };
  const paw = hit.answers.paw && pawFrom(hit.answers.paw);
  // A PAW instance path in the address is PAW by itself: only a PAW serves it.
  // Without an anonymous list, Test loads it (browser login on a 401).
  if (paw || parsed.pawDatabase || pawBehindLogin(hit.answers.paw) || pawChallenge(hit.answers.servers)) {
    return { ...base, kind: 'paw', databases: paw || [], ...(parsed.pawDatabase ? { pawDatabase: parsed.pawDatabase } : {}) };
  }
  const c = classifyServersAnswer(hit.answers.servers);
  if (!c) { return { ...base, ok: false }; }
  if (c.kind === 'admin') { return { ...base, kind: 'admin', databases: c.databases }; }
  if (c.kind === 'v11') { return { ...base, kind: 'v11', auth: c.auth }; }
  return { ...base, kind: 'v12', ...(parsed.v12 ? { v12: parsed.v12 } : {}) };
}
