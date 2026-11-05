import { describe, it, expect } from 'vitest';
import { rowAttrSelect, buildSetExprQuery } from '../tm1Rest/dimensionSetQueryPure';

describe('rowAttrSelect — the ROW attribute part of the $select', () => {
  it('without a request only Caption, NOT the whole collection', () => {
    // The actual gain: it applies even to someone who never touches the new
    // selection. `parseSetAnswer` is the only place that reads
    // `m.Attributes` — nobody needs more than Caption.
    expect(rowAttrSelect([])).toBe(',Attributes/Caption');
  });

  it('identifier-safe names become paths', () => {
    expect(rowAttrSelect(['SITENAME', 'Kostenstelle']))
      .toBe(',Attributes/Caption,Attributes/SITENAME,Attributes/Kostenstelle');
  });

  it('Caption requested twice still appears only once', () => {
    expect(rowAttrSelect(['Caption', 'SITENAME']))
      .toBe(',Attributes/Caption,Attributes/SITENAME');
  });

  it('deduplicates and drops empty entries', () => {
    expect(rowAttrSelect(['A', 'A', '', 'B'])).toBe(',Attributes/Caption,Attributes/A,Attributes/B');
  });

  it('ONE odd name tips the WHOLE selection over to the collection', () => {
    // Measured live on 11.8 (2026-08-25): `Attributes/Technischer Platz`
    // fails raw, `encodeURIComponent`-ed, in single quotes and in square
    // brackets — all four with HTTP 400. Through the whole collection the
    // value arrives. No regression: that IS the current state.
    expect(rowAttrSelect(['SITENAME', 'Technischer Platz'])).toBe(',Attributes');
    expect(rowAttrSelect(['archiviert am'])).toBe(',Attributes');
  });
});

describe('buildSetExprQuery passes the row request through', () => {
  it('without a request Caption is in the Members projection', () => {
    const q = buildSetExprQuery({ kind: 'name' });
    expect(q).toContain('$select=Name,UniqueName,DisplayInfo,Attributes/Caption;');
  });

  it('with a request the paths are there', () => {
    const q = buildSetExprQuery({ kind: 'name' }, ['SITENAME']);
    expect(q).toContain('$select=Name,UniqueName,DisplayInfo,Attributes/Caption,Attributes/SITENAME;');
  });

  it('the PARENT projection stays untouched', () => {
    // `chain.attrs` requests the attributes of the ANCESTORS; the row request
    // is a second, independent axis. Whoever mixes them makes the
    // indentation lookup run into nothing.
    const q = buildSetExprQuery({ kind: 'name', attrs: ['SITENAME'] }, ['Kostenstelle']);
    expect(q).toContain('$expand=Parent($select=Name,Attributes/SITENAME');
    expect(q).toContain('DisplayInfo,Attributes/Caption,Attributes/Kostenstelle;');
  });
});
