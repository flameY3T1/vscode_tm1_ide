import { describe, it, expect } from 'vitest';
import {
  reconcileDiscovery, discoveredProfileId,
  type DiscoveredProfileLike,
} from '../../providers/adminDiscoveryPure';
import type { AdminInstance } from '../../tm1Rest/adminServerApi';

function inst(name: string, host: string, acceptingClients = true): AdminInstance {
  // `AdminInstance` only gained the address fields after this test was written; they
  // play no role in the matching, but they must be present, otherwise
  // `npm run typecheck` is red (the value comes from the admin server; here
  // empty defaults suffice).
  return {
    name, host, acceptingClients, usingSSL: host.startsWith('https'),
    ipAddress: '', ipv6Address: '', httpPortNumber: 0,
  };
}
function prof(p: Partial<DiscoveredProfileLike> & { id: string }): DiscoveredProfileLike {
  return { name: p.id, serverUrl: '', ...p };
}

describe('discoveredProfileId', () => {
  it('is stable and separates the same instance under two admin servers', () => {
    expect(discoveredProfileId('A1', 'SALES')).toBe(discoveredProfileId('A1', 'SALES'));
    expect(discoveredProfileId('A1', 'SALES')).not.toBe(discoveredProfileId('A2', 'SALES'));
  });
});

describe('reconcileDiscovery', () => {
  it('creates a profile for a newly reported instance', () => {
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://h:12357')], [], []);
    expect(r.toCreate).toEqual([{
      id: discoveredProfileId('A1', 'SALES'),
      name: 'SALES',
      serverUrl: 'https://h:12357',
      discoveredName: 'SALES',
      discoveredUrl: 'https://h:12357',
    }]);
    expect(r.visibleIds).toEqual([discoveredProfileId('A1', 'SALES')]);
  });

  it('skips an instance that is not accepting clients', () => {
    const r = reconcileDiscovery('A1', [inst('RISK', 'https://h:1', false)], [], []);
    expect(r.toCreate).toEqual([]);
    expect(r.visibleIds).toEqual([]);
  });

  it('skips an instance the user took out of the group', () => {
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://h:12357')], [], ['SALES']);
    expect(r.toCreate).toEqual([]);
    expect(r.visibleIds).toEqual([]);
  });

  it('recognises an existing profile instead of creating a second one', () => {
    const id = discoveredProfileId('A1', 'SALES');
    const existing = [prof({ id, name: 'SALES', serverUrl: 'https://h:12357', discoveredName: 'SALES', discoveredUrl: 'https://h:12357' })];
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://h:12357')], existing, []);
    expect(r.toCreate).toEqual([]);
    expect(r.toUpdateUrl).toEqual([]);
    expect(r.visibleIds).toEqual([id]);
  });

  it('follows a moved instance as long as the user never touched the URL', () => {
    const id = discoveredProfileId('A1', 'SALES');
    const existing = [prof({ id, serverUrl: 'https://old:1', discoveredName: 'SALES', discoveredUrl: 'https://old:1' })];
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://new:2')], existing, []);
    expect(r.toUpdateUrl).toEqual([{ id, serverUrl: 'https://new:2', discoveredUrl: 'https://new:2' }]);
    expect(r.divergedIds).toEqual([]);
  });

  it('keeps a URL the user corrected — and still records the reported one', () => {
    // The most important case: the user has changed the reported URL to a
    // working one. Overwriting it would be data loss on every expand.
    const id = discoveredProfileId('A1', 'SALES');
    const existing = [prof({ id, serverUrl: 'https://fixed:9', discoveredName: 'SALES', discoveredUrl: 'https://old:1' })];
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://new:2')], existing, []);
    expect(r.toUpdateUrl).toEqual([]);
    expect(r.toTouchDiscoveredUrl).toEqual([{ id, discoveredUrl: 'https://new:2' }]);
    expect(r.divergedIds).toEqual([id]);
    expect(r.visibleIds).toEqual([id]);
  });

  it('renaming the profile does not break the match — discoveredName carries it', () => {
    const id = discoveredProfileId('A1', 'SALES');
    const existing = [prof({ id, name: 'Produktion Düsseldorf', serverUrl: 'https://h:1', discoveredName: 'SALES', discoveredUrl: 'https://h:1' })];
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://h:1')], existing, []);
    expect(r.toCreate).toEqual([]);
    expect(r.visibleIds).toEqual([id]);
  });

  it('reports a profile the admin server no longer mentions as stale — never deletes', () => {
    const id = discoveredProfileId('A1', 'GONE');
    const existing = [prof({ id, discoveredName: 'GONE', serverUrl: 'https://h:1', discoveredUrl: 'https://h:1' })];
    const r = reconcileDiscovery('A1', [], existing, []);
    expect(r.staleIds).toEqual([id]);
    expect(r.visibleIds).toEqual([id]);
    expect(r.toCreate).toEqual([]);
  });

  it('counts an instance that stopped accepting clients as stale, not as gone', () => {
    const id = discoveredProfileId('A1', 'SALES');
    const existing = [prof({ id, discoveredName: 'SALES', serverUrl: 'https://h:1', discoveredUrl: 'https://h:1' })];
    const r = reconcileDiscovery('A1', [inst('SALES', 'https://h:1', false)], existing, []);
    expect(r.staleIds).toEqual([id]);
  });

  it('sorts visible entries by name so the tree order is stable', () => {
    const r = reconcileDiscovery('A1', [inst('Zeta', 'https://h:2'), inst('Alpha', 'https://h:1')], [], []);
    expect(r.toCreate.map(c => c.name)).toEqual(['Alpha', 'Zeta']);
  });
});
