// src/security/api/groupsApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import { parseBody } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { Group } from '../types/group';
import { isSystemGroup } from '../types/group';
import { encodeKey } from './_odata';

interface GroupsResponse {
  value: Array<{ Name: string; Users?: unknown[] }>;
}

export async function listGroups(cfg: Tm1Config): Promise<Group[]> {
  // TM1 11.x: Groups entity has no `IsSystemEntity` property — derive via name pattern.
  const res = await apiRequest('GET', 'Groups?$select=Name&$expand=Users($select=Name)', undefined, undefined, cfg);
  assertOk(res, 'listGroups');
  const parsed = parseBody<GroupsResponse>(res);
  return parsed.value.map(g => ({
    name: g.Name,
    isSystem: isSystemGroup(g.Name) || g.Name.startsWith('}'),
    memberCount: (g.Users ?? []).length,
  }));
}

export async function createGroup(cfg: Tm1Config, name: string): Promise<void> {
  const res = await apiRequest('POST', 'Groups', JSON.stringify({ Name: name }), undefined, cfg);
  assertOk(res, 'createGroup');
}

export async function deleteGroup(cfg: Tm1Config, name: string): Promise<void> {
  // URL path key → quote-doubling AND percent-encoding (`encodeKey`).
  const res = await apiRequest('DELETE', `Groups('${encodeKey(name)}')`, undefined, undefined, cfg);
  assertOk(res, 'deleteGroup');
}
