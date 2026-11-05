// src/webviewClient/securityUserGroup/statePure.ts
import type { User } from '../../security/types/user';
import type { Group } from '../../security/types/group';

export type TabId = 'users' | 'groups' | 'memberships';

export interface Store {
  users: User[];
  groups: Group[];
  activeTab: TabId;
  currentMemberships: Set<string>;
  originalMemberships: Set<string>;
  /** Alias attributes of `}Clients` that can be chosen from. */
  aliasDefs: string[];
  /** Chosen alias attribute; empty = display under the real name. */
  alias: string;
  /** User name → alias value. Filled only for the chosen attribute. */
  aliasValues: Record<string, string>;
}

function membershipKey(user: string, group: string): string {
  return `${user}::${group}`;
}

function seedMemberships(users: User[]): Set<string> {
  const out = new Set<string>();
  for (const u of users) {
    for (const g of u.groups) out.add(membershipKey(u.name, g));
  }
  return out;
}

export function initStore(users: User[], groups: Group[], aliasDefs: string[] = []): Store {
  const original = seedMemberships(users);
  return {
    users,
    groups,
    activeTab: 'users',
    currentMemberships: new Set(original),
    originalMemberships: original,
    aliasDefs,
    alias: '',
    aliasValues: {},
  };
}

/**
 * Set the display alias. Without an alias the values are dropped as well, so that no
 * remnant of an earlier choice stays behind.
 */
export function setAlias(store: Store, alias: string, values: Record<string, string>): Store {
  return alias
    ? { ...store, alias, aliasValues: values }
    : { ...store, alias: '', aliasValues: {} };
}

/**
 * How a user is labelled.
 *
 * The real name always remains the key — it is in `data-user` and
 * goes to the server. This is solely about what the human reads: with
 * CAM the name is an identifier from the directory service, only the
 * alias is readable. If the alias is missing for an individual user, that user's name
 * stays — an empty row would be worse than a cryptic one.
 */
export function displayName(store: Store, name: string): string {
  if (!store.alias) { return name; }
  const v = store.aliasValues[name];
  return v && v !== '' ? v : name;
}

/**
 * Filter box: case-insensitive substring on the real name AND the shown label,
 * so a CAM user is found by the readable alias as well as by the identifier.
 */
export function matchesFilter(store: Store, name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') { return true; }
  return name.toLowerCase().includes(q) || displayName(store, name).toLowerCase().includes(q);
}

export function setActiveTab(store: Store, tab: TabId): Store {
  return { ...store, activeTab: tab };
}

export function toggleMembership(store: Store, user: string, group: string): Store {
  const key = membershipKey(user, group);
  const next = new Set(store.currentMemberships);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return { ...store, currentMemberships: next };
}

export function revertMemberships(store: Store): Store {
  return { ...store, currentMemberships: new Set(store.originalMemberships) };
}

export function isMember(store: Store, user: string, group: string): boolean {
  return store.currentMemberships.has(membershipKey(user, group));
}

export interface MembershipChange {
  user: string;
  group: string;
  op: 'add' | 'remove';
}

export function computeMembershipChanges(store: Store): MembershipChange[] {
  const changes: MembershipChange[] = [];
  // Additions
  for (const key of store.currentMemberships) {
    if (!store.originalMemberships.has(key)) {
      const [user, group] = key.split('::');
      changes.push({ user, group, op: 'add' });
    }
  }
  // Removals
  for (const key of store.originalMemberships) {
    if (!store.currentMemberships.has(key)) {
      const [user, group] = key.split('::');
      changes.push({ user, group, op: 'remove' });
    }
  }
  return changes;
}

export function isMembershipDirty(store: Store): boolean {
  return computeMembershipChanges(store).length > 0;
}

/** Groups of a user as currently staged (not yet saved). */
export function stagedGroups(store: Store, user: string): string[] {
  return store.groups.map(g => g.name).filter(g => isMember(store, user, g));
}

/**
 * What copying the groups of `source` onto `target` changes.
 *
 * `replace` makes the target's groups equal to the source's; `add` only adds
 * the source's groups and keeps everything the target already has.
 */
export function planCopyGroups(
  store: Store, target: string, source: string, mode: 'replace' | 'add',
): { add: string[]; remove: string[] } {
  const want = new Set(stagedGroups(store, source));
  const have = stagedGroups(store, target);
  return {
    add: [...want].filter(g => !isMember(store, target, g)),
    remove: mode === 'replace' ? have.filter(g => !want.has(g)) : [],
  };
}

/** Stage a copy plan — saved with the other membership changes. */
export function applyCopyGroups(
  store: Store, target: string, plan: { add: string[]; remove: string[] },
): Store {
  const next = new Set(store.currentMemberships);
  for (const g of plan.add) { next.add(membershipKey(target, g)); }
  for (const g of plan.remove) { next.delete(membershipKey(target, g)); }
  return { ...store, currentMemberships: next };
}
