/**
 * Write path for the MDX-view display alias.
 *
 * The cube viewer's Alias context menu stores the pick in `Subset.Alias` for a
 * native view. An MDX view has no axis subsets, so the pick has to end up in the
 * MDX text as a `DIMENSION PROPERTIES` clause — that translation is what
 * `aliasMdxSyncPure` does. `null` means "no edit at all": the click handler must
 * not touch Monaco then, or the user gets an empty undo step.
 */
import { describe, it, expect } from 'vitest';
import {
  axisIndexForDim,
  syncAliasIntoMdx,
} from '../webviewClient/cubeViewerMonaco/aliasMdxSyncPure';
import { detectDimensionProperties } from '../mdx/dimensionPropertiesPure';

const MDX = [
  'SELECT {[Konten].MEMBERS} ON 0,',
  '       {[Jahre].MEMBERS} ON 1',
  'FROM [Plan]',
].join('\n');

const base = {
  isMdxView: true,
  rowDims: ['Jahre'],
  colDims: ['Konten'],
};

describe('syncAliasIntoMdx', () => {
  it('puts a row dimension\'s alias on ON 1', () => {
    const next = syncAliasIntoMdx({ ...base, mdx: MDX, dim: 'Jahre', alias: 'ALIAS_TEXT' });
    expect(next).not.toBeNull();
    const rowLine = next!.split('\n')[1];
    expect(rowLine).toContain('DIMENSION PROPERTIES [Jahre].[Jahre].[ALIAS_TEXT]');
    expect(rowLine).toMatch(/ON 1$/);
    // The columns segment stays character-identical.
    expect(next!.split('\n')[0]).toBe('SELECT {[Konten].MEMBERS} ON 0,');
    expect(detectDimensionProperties(next!)).toEqual({ Jahre: 'ALIAS_TEXT' });
  });

  it('puts a column dimension\'s alias on ON 0', () => {
    const next = syncAliasIntoMdx({ ...base, mdx: MDX, dim: 'Konten', alias: 'ALIAS_TEXT' });
    expect(next).not.toBeNull();
    const colLine = next!.split('\n')[0];
    expect(colLine).toContain('DIMENSION PROPERTIES [Konten].[Konten].[ALIAS_TEXT]');
    expect(colLine).toMatch(/ON 0,$/);
    expect(next!.split('\n')[1]).toBe('       {[Jahre].MEMBERS} ON 1');
    expect(detectDimensionProperties(next!)).toEqual({ Konten: 'ALIAS_TEXT' });
  });

  it('returns null for a dimension on neither axis (title/context dim)', () => {
    expect(syncAliasIntoMdx({
      ...base, mdx: MDX, dim: 'Datenarten', alias: 'ALIAS_TEXT',
    })).toBeNull();
  });

  it('drops the whole clause when the alias is removed', () => {
    const withAlias = syncAliasIntoMdx({
      ...base, mdx: MDX, dim: 'Jahre', alias: 'ALIAS_TEXT',
    })!;
    const cleared = syncAliasIntoMdx({ ...base, mdx: withAlias, dim: 'Jahre', alias: null });
    expect(cleared).toBe(MDX); // round-trips back to the original text
    expect(cleared).not.toContain('DIMENSION PROPERTIES');
    expect(detectDimensionProperties(cleared!)).toEqual({});
  });

  it('returns null when the alias is already what the clause says (no empty undo step)', () => {
    const withAlias = syncAliasIntoMdx({
      ...base, mdx: MDX, dim: 'Jahre', alias: 'ALIAS_TEXT',
    })!;
    expect(syncAliasIntoMdx({
      ...base, mdx: withAlias, dim: 'Jahre', alias: 'ALIAS_TEXT',
    })).toBeNull();
  });

  it('returns null when there is no alias to remove either', () => {
    expect(syncAliasIntoMdx({ ...base, mdx: MDX, dim: 'Jahre', alias: null })).toBeNull();
  });

  it('returns null for a native (non-MDX) view', () => {
    expect(syncAliasIntoMdx({
      ...base, isMdxView: false, mdx: MDX, dim: 'Jahre', alias: 'ALIAS_TEXT',
    })).toBeNull();
  });

  it('returns null when there is no MDX text at all', () => {
    expect(syncAliasIntoMdx({ ...base, mdx: null, dim: 'Jahre', alias: 'ALIAS_TEXT' })).toBeNull();
    expect(syncAliasIntoMdx({ ...base, mdx: '  ', dim: 'Jahre', alias: 'ALIAS_TEXT' })).toBeNull();
  });

  it('returns null on unparsable MDX instead of mangling it', () => {
    expect(syncAliasIntoMdx({
      ...base, mdx: 'not an mdx statement', dim: 'Jahre', alias: 'ALIAS_TEXT',
    })).toBeNull();
  });

  it('matches the axis dimension case-insensitively (TM1 names are)', () => {
    const next = syncAliasIntoMdx({ ...base, mdx: MDX, dim: 'jahre', alias: 'ALIAS_TEXT' });
    expect(next).not.toBeNull();
    expect(next!.split('\n')[1]).toContain('DIMENSION PROPERTIES [jahre].[jahre].[ALIAS_TEXT]');
  });

  it('addresses the hierarchy of an alternate-hierarchy key (Codex review 2026-09-28, F2)', () => {
    const next = syncAliasIntoMdx({
      ...base, rowDims: ['Jahre:Quartale'], mdx: MDX, dim: 'Jahre:Quartale', alias: 'ALIAS_TEXT',
    });
    expect(next!).toContain('[Jahre].[Quartale].[ALIAS_TEXT]');
    expect(next!).not.toContain('[Jahre:Quartale]');
  });

  it('leaves a second dimension on the same axis untouched (crossjoin)', () => {
    const cross = 'SELECT {[Konten].MEMBERS} * {[Datenarten].MEMBERS} ON 0,\n'
      + '       {[Jahre].MEMBERS} ON 1\nFROM [Cube]';
    const cols = ['Konten', 'Datenarten'];
    const one = syncAliasIntoMdx({
      isMdxView: true, rowDims: ['Jahre'], colDims: cols,
      mdx: cross, dim: 'Konten', alias: 'ALIAS_TEXT',
    })!;
    expect(detectDimensionProperties(one)).toEqual({ Konten: 'ALIAS_TEXT' });
    const two = syncAliasIntoMdx({
      isMdxView: true, rowDims: ['Jahre'], colDims: cols,
      mdx: one, dim: 'Datenarten', alias: 'CAPTION_X',
    })!;
    expect(detectDimensionProperties(two))
      .toEqual({ Konten: 'ALIAS_TEXT', Datenarten: 'CAPTION_X' });
    expect(two.split('\n')[1]).toBe('       {[Jahre].MEMBERS} ON 1');
  });
});

describe('axisIndexForDim', () => {
  it('maps columns to 0, rows to 1 and everything else to null', () => {
    expect(axisIndexForDim('Konten', ['Jahre'], ['Konten'])).toBe(0);
    expect(axisIndexForDim('Jahre', ['Jahre'], ['Konten'])).toBe(1);
    expect(axisIndexForDim('Datenarten', ['Jahre'], ['Konten'])).toBeNull();
  });
});
