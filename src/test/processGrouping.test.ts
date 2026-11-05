import { describe, it, expect } from 'vitest';
import { groupProcessesByMarker } from '../providers/processGroupingPure';

const SUFFIX = '#####';

describe('groupProcessesByMarker', () => {
  it('returns [] for empty input', () => {
    expect(groupProcessesByMarker([], SUFFIX)).toEqual([]);
  });

  it('returns a single ungrouped bucket when no name ends with the suffix', () => {
    const groups = groupProcessesByMarker(['Beta', 'Alpha', 'Gamma'], SUFFIX);
    expect(groups).toHaveLength(1);
    expect(groups[0].marker).toBeNull();
    expect(groups[0].children).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('treats a sole marker as its own group with itself as the child', () => {
    const groups = groupProcessesByMarker(['_Load_#####'], SUFFIX);
    expect(groups).toEqual([{ marker: '_Load_#####', children: ['_Load_#####'] }]);
  });

  it('groups subsequent processes under the preceding marker', () => {
    const names = ['_Load_#####', '_Load_Cube_A', '_Load_Cube_B', '_Save_#####', '_Save_Daily'];
    const groups = groupProcessesByMarker(names, SUFFIX);
    expect(groups).toEqual([
      { marker: '_Load_#####', children: ['_Load_#####', '_Load_Cube_A', '_Load_Cube_B'] },
      { marker: '_Save_#####', children: ['_Save_#####', '_Save_Daily'] },
    ]);
  });

  it('puts processes appearing before the first marker into an "ungrouped" bucket', () => {
    const names = ['Aaa', 'Bbb', 'M_#####', 'M_X'];
    const groups = groupProcessesByMarker(names, SUFFIX);
    expect(groups).toEqual([
      { marker: null, children: ['Aaa', 'Bbb'] },
      { marker: 'M_#####', children: ['M_#####', 'M_X'] },
    ]);
  });

  it('omits the leading bucket when the first sorted name is already a marker', () => {
    const names = ['_Load_Cube', '_Load_#####'];
    const groups = groupProcessesByMarker(names, SUFFIX);
    // '_Load_#####' sorts before '_Load_Cube' (case-insensitive), so no ungrouped bucket
    expect(groups).toEqual([
      { marker: '_Load_#####', children: ['_Load_#####', '_Load_Cube'] },
    ]);
  });

  it('sorts case-insensitively', () => {
    const names = ['zeta', 'Alpha', 'beta'];
    const groups = groupProcessesByMarker(names, SUFFIX);
    expect(groups[0].children).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('does not mutate the input array', () => {
    const names = ['B', 'A'];
    groupProcessesByMarker(names, SUFFIX);
    expect(names).toEqual(['B', 'A']);
  });

  describe('empty token = no grouping', () => {
    it('returns [] for empty input even with an empty token', () => {
      expect(groupProcessesByMarker([], '')).toEqual([]);
      expect(groupProcessesByMarker([], '', 'prefix')).toEqual([]);
    });

    it('returns one ungrouped bucket with all names in suffix mode', () => {
      const names = ['zeta', 'Alpha', '_Load_#####', 'beta'];
      const groups = groupProcessesByMarker(names, '');
      expect(groups).toEqual([
        { marker: null, children: ['_Load_#####', 'Alpha', 'beta', 'zeta'] },
      ]);
    });

    it('returns one ungrouped bucket with all names in prefix mode', () => {
      const names = ['zeta', 'Alpha', 'GRP_Load', 'beta'];
      const groups = groupProcessesByMarker(names, '', 'prefix');
      expect(groups).toEqual([
        { marker: null, children: ['Alpha', 'beta', 'GRP_Load', 'zeta'] },
      ]);
    });

    it('does not mutate the input array', () => {
      const names = ['B', 'A'];
      groupProcessesByMarker(names, '');
      expect(names).toEqual(['B', 'A']);
    });
  });

  it('respects a custom suffix', () => {
    const names = ['Group::', 'Group::Item', 'Other'];
    const groups = groupProcessesByMarker(names, '::');
    // Sorted order: 'Group::' (marker) < 'Group::Item' < 'Other' — both non-markers fall under the open bucket.
    expect(groups).toEqual([
      { marker: 'Group::', children: ['Group::', 'Group::Item', 'Other'] },
    ]);
  });

  describe('prefix mode', () => {
    it('returns [] for empty input', () => {
      expect(groupProcessesByMarker([], 'GRP_', 'prefix')).toEqual([]);
    });

    it('returns a single ungrouped bucket when no name starts with the prefix', () => {
      const groups = groupProcessesByMarker(['Beta', 'Alpha', 'Gamma'], 'GRP_', 'prefix');
      expect(groups).toEqual([
        { marker: null, children: ['Alpha', 'Beta', 'Gamma'] },
      ]);
    });

    it('treats every name starting with the prefix as its own marker', () => {
      const names = ['GRP_Load', 'GRP_Load_Cube_A', 'GRP_Save'];
      const groups = groupProcessesByMarker(names, 'GRP_', 'prefix');
      expect(groups).toEqual([
        { marker: 'GRP_Load', children: ['GRP_Load'] },
        { marker: 'GRP_Load_Cube_A', children: ['GRP_Load_Cube_A'] },
        { marker: 'GRP_Save', children: ['GRP_Save'] },
      ]);
    });

    it('mixes marker and non-marker names with prefix matching', () => {
      const names = ['Aaa', 'Bbb', '_Load_X', '_Load_Y', 'Zzz'];
      const groups = groupProcessesByMarker(names, '_Load_', 'prefix');
      // Sorted (case-insensitive): _Load_X < _Load_Y < Aaa < Bbb < Zzz
      expect(groups).toEqual([
        { marker: '_Load_X', children: ['_Load_X'] },
        { marker: '_Load_Y', children: ['_Load_Y', 'Aaa', 'Bbb', 'Zzz'] },
      ]);
    });

    it('puts non-marker names before the first marker into ungrouped bucket', () => {
      const names = ['Aaa', 'Bbb', 'PFX_X'];
      const groups = groupProcessesByMarker(names, 'PFX_', 'prefix');
      expect(groups).toEqual([
        { marker: null, children: ['Aaa', 'Bbb'] },
        { marker: 'PFX_X', children: ['PFX_X'] },
      ]);
    });

    it('does not mutate the input array', () => {
      const names = ['B', 'A'];
      groupProcessesByMarker(names, 'X', 'prefix');
      expect(names).toEqual(['B', 'A']);
    });
  });
});
