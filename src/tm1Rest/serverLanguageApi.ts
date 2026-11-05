// src/tm1Rest/serverLanguageApi.ts
//
// Read the configured language of the TM1 server — one value, one fetch.
//
// Needed by the message log analyses: they read the English and the German
// spelling, and with any third language they recognize nothing anymore
// (see `commands/serverLanguagePure.ts`).
//
// Deliberately NOT via `serverConfig/configApi.ts#fetchAll`: that fetches
// three endpoints and builds the whole snapshot for the configuration
// editor. That is too expensive for a single field, and the editor is tied
// to a data structure that should not have to evolve alongside this purpose.

import { apiRequest } from './client';
import type { Tm1Config } from './transport/types';
import { parseBodySafe } from './parseRest';
import { isOk } from './httpError';

/**
 * Search for the `Language` leaf at any depth.
 *
 * The REST interface returns the same leaf at a different depth depending on
 * the endpoint: `/ActiveConfiguration` and `/StaticConfiguration` answer
 * nested (there it hangs under `Administration`), the older flat view
 * `/Configuration` has it at the top level. Instead of guessing one of the
 * two shapes, this searches for the leaf name — which is the same in both.
 *
 * `maxDepth` caps the recursion: the response comes from the server, and an
 * unbounded depth-first search over foreign data is an invitation.
 */
function findLanguageLeaf(node: unknown, depth = 0): string | undefined {
  if (depth > 6 || node === null || typeof node !== 'object' || Array.isArray(node)) {
    return undefined;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'Language' && typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findLanguageLeaf(value, depth + 1);
    if (found !== undefined) { return found; }
  }
  return undefined;
}

/** For tests only: the pure search without network access. */
export const _findLanguageLeafForTest = findLanguageLeaf;

/**
 * The configured server language, or `undefined` when it cannot be had.
 *
 * `undefined` covers three cases that deliberately collapse into one here:
 * the endpoint does not answer (v12, older server), the user is not allowed
 * to read the configuration (the language sits under `Administration`,
 * which not everyone is permitted to read), or the leaf is missing. All
 * three mean the same thing to the caller: **assert nothing**. A failure
 * here must not raise a message — the caller wanted a hint, not a second
 * source of errors.
 *
 * `ActiveConfiguration` first, because that holds the RUNNING value. The
 * static view carries what is in `tm1s.cfg` — after a change without a
 * restart, that is something different from what the server is currently
 * running with.
 *
 * MEASURED on 2026-09-01 against 11.8 (serverLanguageProbe.js),
 * and the result is inconvenient:
 *
 * - The flat view `/Configuration`, which anyone may read, does NOT know
 *   `Language` AT ALL — 22 keys, none of them the language. It stays here as
 *   a second path because it costs nothing and other outputs may lead to
 *   it, but it does not carry the value on 11.8.
 * - `/ActiveConfiguration` and `/StaticConfiguration` REQUIRE ADMIN RIGHTS.
 *   Without admin rights they answer with **HTTP 400** and
 *   `{"code":"63","message":"ObjectSecurityNoAdminRights"}` — a 400, not a
 *   401 or 403. The check below therefore goes by "not 2xx" and not by an
 *   auth status list.
 *
 * For a user without admin rights, the language is thus unavailable, and the
 * hint from the log analyses stays silent. Deliberately decided this way
 * (2026-09-01): a guessed value would be worse than no word at all.
 */
export async function fetchServerLanguage(
  cfg: Tm1Config,
  timeoutMs = 10_000,
): Promise<string | undefined> {
  for (const endpoint of ['ActiveConfiguration', 'Configuration']) {
    try {
      const res = await apiRequest('GET', endpoint, undefined, timeoutMs, cfg);
      if (!isOk(res)) { continue; }
      const found = findLanguageLeaf(parseBodySafe<Record<string, unknown>>(res, {}));
      if (found !== undefined) { return found; }
    } catch {
      // Network error: the next endpoint may still try, and if that one
      // fails too, the answer is "unknown" — not an error.
    }
  }
  return undefined;
}
