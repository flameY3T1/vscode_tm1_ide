// src/security/api/usersApi.ts
import { apiRequest } from '../../tm1Rest/client';
import { assertOk } from '../../tm1Rest/transport/http';
import { parseBody } from '../../tm1Rest/parseRest';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { User, NewUserInput } from '../types/user';
import { encodeKey } from './_odata';

interface UsersResponse {
  value: Array<{
    Name: string;
    Type: string;
    IsActive?: boolean;
    Groups?: Array<{ Name: string }>;
  }>;
}

export async function listUsers(cfg: Tm1Config): Promise<User[]> {
  const res = await apiRequest('GET', 'Users?$select=Name,Type,IsActive&$expand=Groups($select=Name)', undefined, undefined, cfg);
  assertOk(res, 'listUsers');
  const parsed = parseBody<UsersResponse>(res);
  return parsed.value.map(u => ({
    name: u.Name,
    type: u.Type as User['type'],
    disabled: u.IsActive === false,
    groups: (u.Groups ?? []).map(g => g.Name),
  }));
}

export async function createUser(cfg: Tm1Config, input: NewUserInput): Promise<void> {
  const body: Record<string, unknown> = {
    Name: input.name,
    Type: input.type,
    Password: input.password,
  };
  if (input.groups.length > 0) {
    // `Groups@odata.bind` values are RESOURCE PATHS (URI references), not OData
    // literals — quote-doubling alone is not enough, they must be percent-encoded
    // too (a group name with `/` would otherwise split the path segment).
    body['Groups@odata.bind'] = input.groups.map(g => `Groups('${encodeKey(g)}')`);
  }
  const res = await apiRequest('POST', 'Users', JSON.stringify(body), undefined, cfg);
  assertOk(res, 'createUser');
}

export async function setPassword(cfg: Tm1Config, name: string, password: string): Promise<void> {
  const res = await apiRequest('PATCH', `Users('${encodeKey(name)}')`, JSON.stringify({ Password: password }), undefined, cfg);
  assertOk(res, 'setPassword');
}

export async function deleteUser(cfg: Tm1Config, name: string): Promise<void> {
  const res = await apiRequest('DELETE', `Users('${encodeKey(name)}')`, undefined, undefined, cfg);
  assertOk(res, 'deleteUser');
}
