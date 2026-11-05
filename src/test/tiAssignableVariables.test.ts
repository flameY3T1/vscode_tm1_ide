import { describe, it, expect } from 'vitest';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

/**
 * Built-in TI variables — counterpart to the function signatures.
 *
 * Trigger (2026-08-30): we had the `Datasource*` family listed as a function with
 * one parameter. It is not one: you assign to it.
 *
 *     DatasourceNameForServer = 'datei.csv';   # correct
 *     DatasourceNameForServer('datei.csv');    # TM1 rejects this
 *
 * The completion therefore suggested a form that does not compile. The
 * finding only surfaced when the existence probe reported the whole family as "does
 * not exist" — it calls with parentheses.
 *
 * Measured on 11.8 AND v12: readable without a prior assignment, whereas an
 * invented name fails at exactly that (`zzs = ZzzUnbekannt;` is rejected).
 * That is the difference that separates a built-in variable from an arbitrary
 * name — an ASSIGNMENT proves nothing, TI simply creates it.
 */
const ZUWEISBAR = [
  // Data source in general — present on both kinds of server.
  'DatasourceASCIIDecimalSeparator', 'DatasourceASCIIDelimiter', 'DatasourceASCIIHeaderRecords',
  'DatasourceASCIIQuoteCharacter', 'DatasourceASCIIThousandSeparator', 'DatasourceCubeview',
  'DatasourceDimensionSubset', 'DatasourceNameForClient', 'DatasourceNameForServer',
  'DatasourcePassword', 'DatasourceQuery', 'DatasourceType', 'DatasourceUsername',
  // ODBO/SAP — readable on 11.8, gone on v12 (Cubewise lists them as v11-only).
  'DatasourceODBOCatalog', 'DatasourceODBOConnectionString', 'DatasourceODBOCubeName',
  'DatasourceODBOHierarchyName', 'DatasourceODBOLocation', 'DatasourceODBOProvider',
  'DatasourceODBOSAPClientID', 'DatasourceODBOSAPClientLanguage',
  'DatasourceSAPUsingRoleAuths', 'DatasourceSAPUsingTexts',
  // Error handling and the cell value of the record being read.
  'MinorErrorLogMax', 'OnMinorErrorDoItemSkip', 'NValue', 'SValue', 'Value_Is_String',
];

/** Only for ODBO/SAP: this source type no longer exists in v12. */
const NUR_V11 = ZUWEISBAR.filter(n => n.startsWith('DatasourceODBO') || n.startsWith('DatasourceSAP'));

describe('built-in TI variables', () => {
  it('marks exactly the measured names as assignable', () => {
    const flagged = [...KNOWN_SIGNATURES.values()].filter(s => s.assignable).map(s => s.name).sort();
    expect(flagged).toEqual([...ZUWEISBAR].sort());
  });

  it('carries no parameters — a variable takes no arguments', () => {
    for (const name of ZUWEISBAR) {
      const sig = KNOWN_SIGNATURES.get(name.toLowerCase());
      expect(sig, `${name} fehlt`).toBeDefined();
      expect(sig!.params, name).toEqual([]);
      expect(sig!.minParams, name).toBe(0);
      expect(sig!.maxParams, name).toBe(0);
    }
  });

  it('states a value type, never void — a variable holds a value', () => {
    for (const name of ZUWEISBAR) {
      expect(KNOWN_SIGNATURES.get(name.toLowerCase())!.returnType, name).not.toBe('void');
    }
  });

  it('marks the ODBO/SAP family as dropped in v12, the others not', () => {
    for (const name of ZUWEISBAR) {
      const sig = KNOWN_SIGNATURES.get(name.toLowerCase())!;
      expect(!!sig.deprecatedInV12, name).toBe(NUR_V11.includes(name));
    }
  });
});
