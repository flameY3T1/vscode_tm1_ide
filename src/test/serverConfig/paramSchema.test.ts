// src/test/serverConfig/paramSchema.test.ts
import { describe, it, expect } from 'vitest';
import { PARAM_SCHEMA, lookupSchema, lookupLeafInfo, allClusters, normalizeEnumRead, type Cluster } from '../../serverConfig/paramSchema';

describe('paramSchema', () => {
  it('has no duplicate param names', () => {
    const names = PARAM_SCHEMA.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every param has non-empty description (>= 10 chars)', () => {
    for (const p of PARAM_SCHEMA) {
      expect(p.description.length, `param ${p.name}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('requiresRestart implies isStatic (TM1 11.x invariant)', () => {
    for (const p of PARAM_SCHEMA) {
      if (p.requiresRestart) {
        expect(p.isStatic, `param ${p.name} requiresRestart but not isStatic`).toBe(true);
      }
    }
  });

  // A default value outside the list means: the form shows a row as
  // changed that nobody touched — and for
  // IntegratedSecurityMode it was set to '4', while REST returns names.
  it('every enum param has its defaultValue among its enumValues', () => {
    for (const p of PARAM_SCHEMA) {
      if (p.type !== 'enum' || p.defaultValue === undefined) continue;
      expect(p.enumValues ?? [], `param ${p.name}`).toContain(String(p.defaultValue));
    }
  });

  // What is read is the enum name, what is written is the cfg number. Without the
  // conversion, the field holds a number before saving and a name afterwards.
  it('shows a numeric enum as its number, whatever name REST reported', () => {
    const def = lookupSchema('IntegratedSecurityMode');
    expect(normalizeEnumRead(def, 'Mixed')).toBe('2');
    expect(normalizeEnumRead(def, '3')).toBe('3');
    expect(normalizeEnumRead(lookupSchema('IPVersion'), 'ipv6')).toBe('ipv6');
  });

  it('allClusters returns exactly 10 clusters', () => {
    expect(allClusters().length).toBe(10);
  });

  it('lookupSchema finds known param case-sensitively', () => {
    expect(lookupSchema('HTTPPortNumber')?.cluster).toBe('connection');
    expect(lookupSchema('httpportnumber')).toBeUndefined();
    expect(lookupSchema('UnknownParam')).toBeUndefined();
  });

  it('every ParamDef.cluster is one of the 10 clusters', () => {
    const valid = new Set<Cluster>(allClusters());
    for (const p of PARAM_SCHEMA) {
      expect(valid.has(p.cluster), `param ${p.name} cluster=${p.cluster}`).toBe(true);
    }
  });
});

describe('paramSchema coverage', () => {

  // The path is the way out for exactly these segments — and it has to take effect,
  // otherwise the row would still stand there without a description.
  it('resolves an ambiguous segment through its full path', () => {
    expect(lookupLeafInfo('Administration.TopLog.Enable')).toBeDefined();
    expect(lookupLeafInfo('Access.LDAP.Enable')).toBeDefined();
    expect(lookupLeafInfo('Administration.TopLog.Enable')?.description)
      .not.toBe(lookupLeafInfo('Access.LDAP.Enable')?.description);
  });

  // The eight names proven on 2026-08-31 to be entirely made up — neither on
  // 11.8 (158 leaves) nor on TM1 Database 12 (64) in the tree, in no
  // IBM list. The guard makes sure they do not come back.
  it('carries none of the eight names measured as non-existent', () => {
    for (const gone of [
      'EnableTM1WebMTQ', 'NumericSeparators', 'DateFormat', 'CurrencyFormat',
      'Encoding', 'TI_ParallelLogging', 'ReplicationServerName', 'ReplicationBandwidthLimit',
    ]) {
      expect(lookupSchema(gone), `removed param ${gone}`).toBeUndefined();
      expect(lookupLeafInfo(gone), `removed param ${gone}`).toBeUndefined();
    }
  });
});

describe('normalizeEnumRead haengt am Parameternamen (A10)', () => {
  it('maps the security mode to its cfg number', () => {
    const def = {
      name: 'IntegratedSecurityMode', type: 'enum',
      enumValues: ['1', '2', '3', '4'],
    } as unknown as Parameters<typeof normalizeEnumRead>[0];
    expect(normalizeEnumRead(def, 'Mixed')).toBe('2');
  });

  it('leaves a DIFFERENT numeric enum alone', () => {
    // Until 2026-09-20 the decision was "all values are digits" — a second
    // numeric enum would silently have received the same table.
    const def = {
      name: 'LogLevel', type: 'enum', enumValues: ['1', '2', '3'],
    } as unknown as Parameters<typeof normalizeEnumRead>[0];
    expect(normalizeEnumRead(def, 'Mixed')).toBe('Mixed');
  });

  it('leaves an unknown value of the same parameter in place', () => {
    const def = {
      name: 'IntegratedSecurityMode', type: 'enum', enumValues: ['1'],
    } as unknown as Parameters<typeof normalizeEnumRead>[0];
    expect(normalizeEnumRead(def, 'Sonstwas')).toBe('Sonstwas');
  });
});
