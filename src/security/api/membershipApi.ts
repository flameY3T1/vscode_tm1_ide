import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import { parseBody } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { encodeKey } from './_odata';

export async function getUserGroups(cfg: Tm1Config, userName: string): Promise<string[]> {
  const res = await apiRequest('GET', `Users('${encodeKey(userName)}')/Groups?$select=Name`, undefined, undefined, cfg);
  assertOk(res, 'getUserGroups');
  const parsed = parseBody<{ value: Array<{ Name: string }> }>(res);
  return parsed.value.map(g => g.Name);
}

/**
 * Replace a user's FULL group membership in one PATCH via `Groups@odata.bind` —
 * the same mechanism createUser uses, and reliable across TM1 builds. The
 * per-edge `Groups/$ref` POST returned 2xx on some servers WITHOUT persisting
 * (relative `@odata.id` parsed leniently as a no-op), so a full-set PATCH is the
 * authoritative path. `groups` is the complete desired list (empty = no groups).
 */
export async function setUserGroups(cfg: Tm1Config, userName: string, groups: string[]): Promise<void> {
  // Bind values are resource paths → quote-double + percent-encode (`encodeKey`).
  const body = JSON.stringify({ 'Groups@odata.bind': groups.map(g => `Groups('${encodeKey(g)}')`) });
  const res = await apiRequest('PATCH', `Users('${encodeKey(userName)}')`, body, undefined, cfg);
  assertOk(res, 'setUserGroups');
}
