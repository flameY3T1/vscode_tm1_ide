// src/security/api/clientAliasApi.ts
//
// Alias names of users.
//
// With CAM login, the user name that `GET Users` returns is often not a
// readable name but an identifier from the directory service. What is readable
// is then only an alias attribute of the dimension `}Clients` — the same dimension
// whose elements the users ARE.
//
// Two separate steps, because they differ in cost: the list of
// alias attributes is a small query and is fetched on open; the
// values cost an element query across all users and are fetched only
// when an alias has actually been chosen.
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { listElementAttributes } from '../../tm1Rest/dimensionApi';
import { fetchAttributeValues } from '../../tm1Rest/dimensionElementsApi';
import { METADATA_CAP_MS } from '../../tm1Rest/timeouts';

/** The dimension whose elements are the users. */
const CLIENTS_DIM = '}Clients';

/**
 * The alias attributes of `}Clients`.
 *
 * An empty list means "no aliases" AND "not readable" — the difference changes
 * nothing in the display, and a missing alias must not hold up the user
 * manager.
 */
export async function listClientAliasAttributes(cfg: Tm1Config): Promise<string[]> {
  try {
    const rows = await listElementAttributes(cfg, CLIENTS_DIM, CLIENTS_DIM, METADATA_CAP_MS);
    return rows.filter(a => a.Type === 'Alias').map(a => a.Name);
  } catch {
    return [];
  }
}

/**
 * User name → alias value for ONE alias attribute.
 *
 * Empty values are left out: an element without a maintained alias should
 * appear under its real name, not under an empty row. Note, this
 * also holds when the alias equals the name — TM1 then returns it
 * anyway, unlike MDX `Properties()`.
 */
export async function fetchClientAliasValues(cfg: Tm1Config, alias: string): Promise<Record<string, string>> {
  if (!alias) { return {}; }
  try {
    return await fetchAttributeValues(cfg, CLIENTS_DIM, CLIENTS_DIM, alias);
  } catch {
    // The origin guard ends up here too: a missing alias costs
    // labels, never data.
    return {};
  }
}
