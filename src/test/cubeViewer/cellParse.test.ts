import { describe, it, expect } from 'vitest';
import { parseCellsPage, parseTitleAndTuples, parseTuplesPage } from '../../commands/cubeViewer/cellParse';

const C = (Ordinal: number, extra: Record<string, unknown>) => ({ Ordinal, FormattedValue: '', ...extra });

describe('parseCellsPage', () => {
  it('maps ordinal → absolute row,col with numCols', () => {
    const { values } = parseCellsPage([C(0, { Value: 1, FormattedValue: '1,00' }), C(3, { Value: 5, FormattedValue: '5,00' })], 2);
    expect(values['0,0']).toBe('1,00');
    expect(values['1,1']).toBe('5,00');   // ordinal 3 = 1*2+1
  });
  it('string cell prefers raw Value over "error" FormattedValue', () => {
    const { values } = parseCellsPage([C(0, { Value: 'Text', FormattedValue: 'error' })], 1);
    expect(values['0,0']).toBe('Text');
  });
  it('empty cell (null value, no formatted) → no key', () => {
    const { values } = parseCellsPage([C(0, { Value: null, FormattedValue: '' })], 1);
    expect(values['0,0']).toBeUndefined();
  });
  it('flags: consolidated/rule', () => {
    const { cellFlags } = parseCellsPage([C(0, { Value: 1, FormattedValue: '1', Consolidated: true, RuleDerived: true, Updateable: false })], 1);
    expect(cellFlags['0,0']).toEqual({ c: 1, r: 1 });
  });
  it('Updateable is a bit mask: bit 0x2 = writable (values measured on 11.8, non-admin user)', () => {
    const { cellFlags } = parseCellsPage([
      C(0, { Value: 1, FormattedValue: '1', Updateable: 0x10a }),                              // writable leaf
      C(1, { Value: 1, FormattedValue: '1', Updateable: 0x102, Consolidated: true }),         // spreadable
      C(2, { Value: 1, FormattedValue: '1', Updateable: 0x10000104, RuleDerived: true, Consolidated: true }),
      C(3, { Value: 1, FormattedValue: '1', Updateable: 0x10000101 }),                         // leaf, security READ
      C(4, { Value: 1, FormattedValue: '1', Updateable: 0x10000101, Consolidated: true }),    // consolidation, security READ
    ], 5);
    expect(cellFlags['0,0']).toBeUndefined();
    expect(cellFlags['0,1']).toEqual({ c: 1 });
    expect(cellFlags['0,2']).toEqual({ c: 1, r: 1 });
    expect(cellFlags['0,3']).toEqual({ u: 0 });
    expect(cellFlags['0,4']).toEqual({ c: 1, u: 0 });
  });
  it('keeps the full-precision raw value even when FormattedValue is rounded', () => {
    const { values, rawValues } = parseCellsPage([C(0, { Value: 1234.56789, FormattedValue: '1.234,57' })], 1);
    expect(values['0,0']).toBe('1.234,57');       // rounded display
    expect(rawValues['0,0']).toBe('1234.56789');  // real value for click readout
  });
  it('keeps raw value for rule-derived cells', () => {
    const { rawValues } = parseCellsPage([C(0, { Value: 42.4242, FormattedValue: '42,42', RuleDerived: true })], 1);
    expect(rawValues['0,0']).toBe('42.4242');
  });
});

describe('parseTitleAndTuples', () => {
  it('derives row/col tuples + title assignments', () => {
    const colAxis = { Ordinal: 0, Hierarchies: [{ Name: 'dimA' }], Tuples: [{ Members: [{ Name: 'a1' }] }, { Members: [{ Name: 'a2' }] }] };
    const rowAxis = { Ordinal: 1, Hierarchies: [{ Name: 'dimB' }], Tuples: [{ Members: [{ Name: 'b1' }] }] };
    const titleAxis = { Ordinal: 2, Hierarchies: [{ Name: 'dimT' }], Tuples: [{ Members: [{ Name: 'tX' }] }] };
    const r = parseTitleAndTuples([colAxis, rowAxis, titleAxis], rowAxis, colAxis);
    expect(r.colElements).toEqual(['a1', 'a2']);
    expect(r.rowElements).toEqual(['b1']);
    expect(r.colDims).toEqual(['dimA']);
    expect(r.rowDims).toEqual(['dimB']);
    expect(r.titleAssignments).toEqual({ dimT: 'tX' });
  });
});

describe('parseTuplesPage', () => {
  it('maps OData tuples to member-name arrays + joined element labels', () => {
    const raw = [
      { Ordinal: 0, Members: [{ Name: 'S1' }, { Name: 'Jan' }] },
      { Ordinal: 1, Members: [{ Name: 'S1' }, { Name: 'Feb' }] },
    ];
    const r = parseTuplesPage(raw);
    expect(r.tuples).toEqual([['S1', 'Jan'], ['S1', 'Feb']]);
    expect(r.elements).toEqual(['S1 / Jan', 'S1 / Feb']);
  });

  it('handles missing/empty Members', () => {
    const r = parseTuplesPage([{ Ordinal: 0 }, { Ordinal: 1, Members: [] }] as never);
    expect(r.tuples).toEqual([[], []]);
    expect(r.elements).toEqual(['', '']);
  });
});

describe('parseTitleAndTuples on capped (paged) structure', () => {
  it('yields rowTuples for only the returned page while dims stay complete', () => {
    const rowAxis = {
      Ordinal: 1, Cardinality: 14784,
      Hierarchies: [{ Name: 'dim_Linie' }, { Name: 'dim_Zeit' }],
      Tuples: [
        { Members: [{ Name: 'S1' }, { Name: 'Jan' }] },
        { Members: [{ Name: 'S1' }, { Name: 'Feb' }] },
      ],
    };
    const colAxis = {
      Ordinal: 0, Cardinality: 1,
      Hierarchies: [{ Name: 'dim_Kennzahl' }],
      Tuples: [{ Members: [{ Name: 'Umsatz' }] }],
    };
    const tt = parseTitleAndTuples([colAxis, rowAxis], rowAxis, colAxis);
    expect(tt.rowDims).toEqual(['dim_Linie', 'dim_Zeit']);
    expect(tt.colDims).toEqual(['dim_Kennzahl']);
    expect(tt.rowTuples.length).toBe(2); // only the page, not 14784
    expect(tt.rowElements).toEqual(['S1 / Jan', 'S1 / Feb']);
  });
});

describe('parseCellsPage string cells', () => {
  it('flags string cells from the server type, empty ones included', () => {
    // Measured 2026-09-23: an empty string cell arrives as Value "" (string).
    const { cellFlags } = parseCellsPage([
      C(0, { Value: '01223', FormattedValue: '01223' }),
      C(1, { Value: '', FormattedValue: '' }),
      C(2, { Value: 1223, FormattedValue: '1,223' }),
    ], 3);
    expect(cellFlags['0,0']).toEqual({ s: 1 });
    expect(cellFlags['0,1']).toEqual({ s: 1 });
    expect(cellFlags['0,2']).toBeUndefined();
  });
});
