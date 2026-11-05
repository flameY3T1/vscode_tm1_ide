import { describe, it, expect } from 'vitest';

import { clusterControlObjects, controlClusterId, splitControlObjects } from '../../providers/controlObjectClusters';

/** Shorthand for the expectation: group key + members. */
function shape(names: string[]): Array<[string, string[]]> {
  return clusterControlObjects(names).map(c => [c.key ?? '<rest>', c.names]);
}

describe('clusterControlObjects', () => {
  it('turns a dotted name into a package', () => {
    // }bedrock.cube.data.clear belongs to Bedrock — the first piece before the
    // dot IS the package name; that is what the package calls itself.
    expect(shape(['}bedrock.cube.data.clear', '}bedrock.hier.h.create'])).toEqual([
      ['bedrock', ['}bedrock.cube.data.clear', '}bedrock.hier.h.create']],
    ]);
  });

  it('keeps two packages apart and sorts them alphabetically', () => {
    const got = shape(['}pulse.log.write', '}bedrock.cube.data.clear']);
    expect(got.map(([k]) => k)).toEqual(['bedrock', 'pulse']);
  });

  it('merges the same package regardless of spelling and takes the first spelling as the name', () => {
    const got = clusterControlObjects(['}Pulse.a', '}pulse.b']);
    expect(got).toHaveLength(1);
    expect(got[0].key).toBe('Pulse');
    expect(got[0].names).toEqual(['}Pulse.a', '}pulse.b']);
  });

  it('groups dotless system objects by the word stem before the underscore', () => {
    expect(shape(['}ElementAttributes_Region', '}ElementAttributes_Konto'])).toEqual([
      ['ElementAttributes', ['}ElementAttributes_Region', '}ElementAttributes_Konto']],
    ]);
  });

  it('otherwise takes the first CamelCase word as the stem', () => {
    expect(shape(['}CubeProperties', '}CubeSecurity'])).toEqual([
      ['Cube', ['}CubeProperties', '}CubeSecurity']],
    ]);
  });

  it('puts a stem with only one member into the rest — a group for one object is just one more click', () => {
    const got = clusterControlObjects(['}Clients', '}Groups', '}CubeProperties', '}CubeSecurity']);
    expect(got.map(c => c.key)).toEqual(['Cube', null]);
    expect(got[1].kind).toBe('rest');
    expect(got[1].names).toEqual(['}Clients', '}Groups']);
  });

  it('keeps a package even as a single item — the package name is a statement, not a coincidence', () => {
    const got = clusterControlObjects(['}bedrock.cube.data.clear', '}Clients']);
    expect(got.map(c => c.key)).toEqual(['bedrock', null]);
  });

  it('orders packages before stems and the rest at the end', () => {
    const got = clusterControlObjects([
      '}Clients',
      '}StatsByCube', '}StatsByClient',
      '}zeta.a', '}zeta.b',
      '}alpha.a',
    ]);
    expect(got.map(c => c.key)).toEqual(['alpha', 'zeta', 'Stats', null]);
  });

  it('keeps the input order within a group', () => {
    const got = clusterControlObjects(['}bedrock.z', '}bedrock.a']);
    expect(got[0].names).toEqual(['}bedrock.z', '}bedrock.a']);
  });

  it('ignores names without the } prefix — those are not control objects', () => {
    expect(clusterControlObjects(['Umsatz', '}Clients', '}Groups'])).toEqual([
      { key: null, kind: 'rest', names: ['}Clients', '}Groups'] },
    ]);
  });

  it('copes with the bare } and empty pieces', () => {
    const got = clusterControlObjects(['}', '}.a', '}_x']);
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe('rest');
    expect(got[0].names).toEqual(['}', '}.a', '}_x']);
  });

  it('returns an empty list for no control objects', () => {
    expect(clusterControlObjects([])).toEqual([]);
    expect(clusterControlObjects(['Umsatz'])).toEqual([]);
  });
});

describe('splitControlObjects', () => {
  it('keeps the order of the ordinary objects', () => {
    const got = splitControlObjects(['Umsatz', '}Clients', 'Konto', '}Groups']);
    expect(got.plain).toEqual(['Umsatz', 'Konto']);
    expect(got.clusters[0].names).toEqual(['}Clients', '}Groups']);
  });

  it('returns no clusters at all without control objects — the tree looks as before', () => {
    // Exactly the "control objects hidden" case: the visibility filter
    // has already removed the `}` names; nothing new may appear here.
    expect(splitControlObjects(['Umsatz', 'Konto'])).toEqual({ plain: ['Umsatz', 'Konto'], clusters: [] });
  });
});

describe('controlClusterId', () => {
  it('distinguishes the rest from a stem that happens to have that name', () => {
    expect(controlClusterId({ key: null, kind: 'rest', names: [] })).toBe('#rest');
    expect(controlClusterId({ key: 'rest', kind: 'stem', names: [] })).toBe('stem:rest');
  });

  it('keeps a package and a stem of the same name apart', () => {
    expect(controlClusterId({ key: 'Stats', kind: 'package', names: [] })).toBe('pkg:stats');
    expect(controlClusterId({ key: 'Stats', kind: 'stem', names: [] })).toBe('stem:stats');
  });
});
