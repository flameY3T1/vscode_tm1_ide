import { describe, it, expect } from 'vitest';
import { parsePicklistDefinition, pickDefinitionForCell } from '../../cubeViewer/picklistPure';

describe('parsePicklistDefinition', () => {
  it('reads the static form', () => {
    expect(parsePicklistDefinition('static:Offen:InArbeit:Fertig'))
      .toEqual({ kind: 'static', values: ['Offen', 'InArbeit', 'Fertig'] });
  });

  it('accepts any spelling of the prefix', () => {
    // Measured live: static / STATIC / Static / StAtIc are equivalent.
    for (const p of ['static', 'STATIC', 'Static', 'StAtIc']) {
      expect(parsePicklistDefinition(`${p}:a:b`))
        .toEqual({ kind: 'static', values: ['a', 'b'] });
    }
  });

  it('keeps spaces WITHIN an entry', () => {
    expect(parsePicklistDefinition('static:mit Leerzeichen:zwei'))
      .toEqual({ kind: 'static', values: ['mit Leerzeichen', 'zwei'] });
  });

  it('allows an empty entry', () => {
    // Measured: `static:a::b` explicitly allows the empty string.
    expect(parsePicklistDefinition('static:a::b'))
      .toEqual({ kind: 'static', values: ['a', '', 'b'] });
  });

  it('cleans away spaces around the WHOLE definition', () => {
    expect(parsePicklistDefinition('  static:x:y  '))
      .toEqual({ kind: 'static', values: ['x', 'y'] });
  });

  it('trims spaces before the prefix colon', () => {
    expect(parsePicklistDefinition('static :a:b'))
      .toEqual({ kind: 'static', values: ['a', 'b'] });
  });

  it('reads dimension: with and without a hierarchy', () => {
    expect(parsePicklistDefinition('dimension:Konten'))
      .toEqual({ kind: 'dimension', dimension: 'Konten' });
    expect(parsePicklistDefinition('Dimension:Konten:Alt'))
      .toEqual({ kind: 'dimension', dimension: 'Konten', hierarchy: 'Alt' });
  });

  it('reads subset: in three- and four-segment form', () => {
    expect(parsePicklistDefinition('subset:Konten:Top'))
      .toEqual({ kind: 'subset', dimension: 'Konten', subset: 'Top' });
    expect(parsePicklistDefinition('subset:Konten:Alt:Top'))
      .toEqual({ kind: 'subset', dimension: 'Konten', hierarchy: 'Alt', subset: 'Top' });
  });

  it('returns null where TM1 silently switches the list off', () => {
    expect(parsePicklistDefinition('')).toBeNull();
    expect(parsePicklistDefinition('   ')).toBeNull();
    expect(parsePicklistDefinition(undefined)).toBeNull();
    expect(parsePicklistDefinition('viertelvorzwoelf:a:b')).toBeNull();
    expect(parsePicklistDefinition('static')).toBeNull();
    expect(parsePicklistDefinition('dimension:')).toBeNull();
    expect(parsePicklistDefinition('subset:NurEinSegment')).toBeNull();
  });
});

describe('pickDefinitionForCell', () => {
  const base = {
    cubeDims: ['Zeile', 'Mass'],
    coordinates: ['A1', 'Txt'],
    byElement: {} as Record<string, Record<string, string>>,
  };

  it('takes the cell level when there is one', () => {
    expect(pickDefinitionForCell({
      ...base,
      cellDef: 'static:AUS_ZELLE',
      byElement: { Zeile: { A1: 'static:AUS_ATTRIBUT' } },
    })).toBe('static:AUS_ZELLE');
  });

  it('falls back to the element attribute', () => {
    expect(pickDefinitionForCell({
      ...base,
      byElement: { Zeile: { A1: 'static:AUS_ATTRIBUT' } },
    })).toBe('static:AUS_ATTRIBUT');
  });

  it('lets the LATER cube dimension win', () => {
    // Measured live: with two attributes on the same cell, the
    // measure dimension (index 1) won over the row dimension (index 0).
    expect(pickDefinitionForCell({
      ...base,
      byElement: {
        Zeile: { A1: 'static:VON_ZEILE' },
        Mass: { Txt: 'static:VON_SPALTE' },
      },
    })).toBe('static:VON_SPALTE');
  });

  it('skips an empty cell definition', () => {
    // Measured: the empty string cancels the list — it must not hide the attribute.
    expect(pickDefinitionForCell({
      ...base,
      cellDef: '',
      byElement: { Zeile: { A1: 'static:AUS_ATTRIBUT' } },
    })).toBe('static:AUS_ATTRIBUT');
  });

  it('returns null when nothing applies', () => {
    expect(pickDefinitionForCell(base)).toBeNull();
  });

  it('returns null when the definition is unreadable', () => {
    expect(pickDefinitionForCell({ ...base, cellDef: 'unsinn:a:b' })).toBeNull();
  });

  it('falls back to the element attribute when the cell definition is unreadable', () => {
    expect(pickDefinitionForCell({
      ...base,
      cellDef: 'unsinn:a:b',
      byElement: { Zeile: { A1: 'static:AUS_ATTRIBUT' } },
    })).toBe('static:AUS_ATTRIBUT');
  });
});
