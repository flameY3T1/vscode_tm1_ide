import { describe, it, expect } from 'vitest';
import {
  initStore, setActiveTab, toggleMembership, revertMemberships,
  computeMembershipChanges, isMembershipDirty, isMember,
  setAlias, displayName, matchesFilter, planCopyGroups, applyCopyGroups,
} from '../../../webviewClient/securityUserGroup/statePure';

const fakeUsers = [
  { name: 'admin',  type: 'Admin' as const, disabled: false, groups: ['ADMIN'] },
  { name: 'sales',  type: 'User'  as const, disabled: false, groups: ['Sales'] },
  { name: 'finance',type: 'User'  as const, disabled: true,  groups: [] },
];
const fakeGroups = [
  { name: 'ADMIN', isSystem: true,  memberCount: 1 },
  { name: 'Sales', isSystem: false, memberCount: 1 },
  { name: 'Finance', isSystem: false, memberCount: 0 },
];

describe('securityUserGroup/statePure', () => {
  describe('initStore', () => {
    it('seeds memberships from users.groups', () => {
      const s = initStore(fakeUsers, fakeGroups);
      expect(isMember(s, 'admin', 'ADMIN')).toBe(true);
      expect(isMember(s, 'sales', 'Sales')).toBe(true);
      expect(isMember(s, 'sales', 'ADMIN')).toBe(false);
      expect(isMember(s, 'finance', 'Sales')).toBe(false);
      expect(isMembershipDirty(s)).toBe(false);
    });
    it('activeTab default = users', () => {
      const s = initStore(fakeUsers, fakeGroups);
      expect(s.activeTab).toBe('users');
    });
  });

  describe('setActiveTab', () => {
    it('switches', () => {
      const s0 = initStore(fakeUsers, fakeGroups);
      const s1 = setActiveTab(s0, 'memberships');
      expect(s1.activeTab).toBe('memberships');
    });
  });

  describe('toggleMembership', () => {
    it('adds new membership → dirty', () => {
      let s = initStore(fakeUsers, fakeGroups);
      s = toggleMembership(s, 'finance', 'Sales');
      expect(isMember(s, 'finance', 'Sales')).toBe(true);
      expect(isMembershipDirty(s)).toBe(true);
    });
    it('removes existing membership → dirty', () => {
      let s = initStore(fakeUsers, fakeGroups);
      s = toggleMembership(s, 'sales', 'Sales');
      expect(isMember(s, 'sales', 'Sales')).toBe(false);
      expect(isMembershipDirty(s)).toBe(true);
    });
    it('toggle back to original → not dirty', () => {
      let s = initStore(fakeUsers, fakeGroups);
      s = toggleMembership(s, 'sales', 'Sales');
      s = toggleMembership(s, 'sales', 'Sales');
      expect(isMembershipDirty(s)).toBe(false);
    });
    it('immutable', () => {
      const s0 = initStore(fakeUsers, fakeGroups);
      toggleMembership(s0, 'sales', 'ADMIN');
      expect(isMember(s0, 'sales', 'ADMIN')).toBe(false);
    });
  });

  describe('revertMemberships', () => {
    it('restores original snapshot', () => {
      let s = initStore(fakeUsers, fakeGroups);
      s = toggleMembership(s, 'sales', 'ADMIN');
      s = toggleMembership(s, 'finance', 'Finance');
      s = revertMemberships(s);
      expect(isMembershipDirty(s)).toBe(false);
      expect(isMember(s, 'sales', 'ADMIN')).toBe(false);
      expect(isMember(s, 'finance', 'Finance')).toBe(false);
    });
  });

  describe('computeMembershipChanges', () => {
    it('returns add + remove entries', () => {
      let s = initStore(fakeUsers, fakeGroups);
      s = toggleMembership(s, 'finance', 'Sales'); // add
      s = toggleMembership(s, 'sales', 'Sales');   // remove
      const changes = computeMembershipChanges(s);
      expect(changes).toHaveLength(2);
      expect(changes).toContainEqual({ user: 'finance', group: 'Sales', op: 'add' });
      expect(changes).toContainEqual({ user: 'sales',   group: 'Sales', op: 'remove' });
    });
    it('no changes → empty', () => {
      const s = initStore(fakeUsers, fakeGroups);
      expect(computeMembershipChanges(s)).toEqual([]);
    });
  });

  describe('Alias-Anzeige', () => {
    it('shows the real name when no alias is selected', () => {
      const s = initStore(fakeUsers, fakeGroups, ['Klarname']);
      expect(s.alias).toBe('');
      expect(displayName(s, 'admin')).toBe('admin');
    });

    it('shows the alias as soon as one is selected', () => {
      // The case this is about: with CAM only the alias carries the name.
      const s = setAlias(initStore(fakeUsers, fakeGroups, ['Klarname']), 'Klarname', { admin: 'Anna Achterberg' });
      expect(displayName(s, 'admin')).toBe('Anna Achterberg');
    });

    it('keeps the real name for users without a maintained alias', () => {
      const s = setAlias(initStore(fakeUsers, fakeGroups), 'Klarname', { admin: 'Anna' });
      expect(displayName(s, 'sales')).toBe('sales');
    });

    it('clears the values when the alias is deselected', () => {
      const chosen = setAlias(initStore(fakeUsers, fakeGroups), 'Klarname', { admin: 'Anna' });
      const cleared = setAlias(chosen, '', { admin: 'Anna' });
      expect(cleared.aliasValues).toEqual({});
      expect(displayName(cleared, 'admin')).toBe('admin');
    });

    it('leaves memberships and tabs untouched — display is not a change', () => {
      const dirty = toggleMembership(setActiveTab(initStore(fakeUsers, fakeGroups), 'memberships'), 'sales', 'Finance');
      const withAlias = setAlias(dirty, 'Klarname', { sales: 'Sabine' });
      expect(withAlias.activeTab).toBe('memberships');
      expect(computeMembershipChanges(withAlias)).toEqual(computeMembershipChanges(dirty));
    });
  });
});

describe('copy groups', () => {
  const users = [
    { name: 'anna', type: 'User' as const, disabled: false, groups: ['Sales', 'Plan'] },
    { name: 'ben', type: 'User' as const, disabled: false, groups: ['Sales', 'HR'] },
  ];
  const groups = ['Sales', 'Plan', 'HR'].map(name => ({ name, isSystem: false, memberCount: 0 }));

  it('replace adds the missing and removes the extra groups', () => {
    const store = initStore(users, groups);
    expect(planCopyGroups(store, 'ben', 'anna', 'replace')).toEqual({ add: ['Plan'], remove: ['HR'] });
  });

  it('add keeps what the target already has', () => {
    const store = initStore(users, groups);
    expect(planCopyGroups(store, 'ben', 'anna', 'add')).toEqual({ add: ['Plan'], remove: [] });
  });

  it('stages the plan as ordinary membership changes', () => {
    const store = initStore(users, groups);
    const next = applyCopyGroups(store, 'ben', planCopyGroups(store, 'ben', 'anna', 'replace'));
    expect(computeMembershipChanges(next)).toEqual([
      { user: 'ben', group: 'Plan', op: 'add' },
      { user: 'ben', group: 'HR', op: 'remove' },
    ]);
  });
});

describe('matchesFilter', () => {
  it('finds a user by the cryptic name and by the shown alias', () => {
    const store = setAlias(initStore(fakeUsers, fakeGroups), 'Full', { [fakeUsers[0].name]: 'Anna Muster' });
    const id = fakeUsers[0].name;
    expect(matchesFilter(store, id, 'muster')).toBe(true);
    expect(matchesFilter(store, id, id.slice(1, 3))).toBe(true);
    expect(matchesFilter(store, id, 'zzz-nobody')).toBe(false);
    expect(matchesFilter(store, id, '  ')).toBe(true);
  });
});
