import { describe, it, expect } from 'vitest';
import {
  splitAttrFormat, attrFormatStatus, composeAttrFormat, attrCubeDimension,
} from '../../webviewClient/cubeViewerMonaco/elementFormatPure';

// Status per measured row (11.8, 2026-09-27): which prefix/pattern pairs TM1 applied.
describe('attrFormatStatus', () => {
  it.each([
    ['b:#,##0;(#,##0)', 'ok'],
    ['c:#,##0,"k"', 'ok'],
    ['b:dd.mm.yyyy', 'ok'],
    ['d:#,##0;-#,##0', 'okLegacy'],
    ['d:0.00E+00', 'okLegacy'],
    ['d:#,##0.00', 'okLegacy'],
    ['d:#,##0 "€"', 'legacyBreaks'],
    ['d:#,##0,"k"', 'legacyBreaks'],
    ['d:#,##0;-#,##0;"–"', 'legacyBreaks'],
    ['d:dd.mm.yyyy', 'legacyBreaks'],
    ['#,##0.00', 'ignored'],
    ['f:#,##0.00', 'ignored'],
    ['p:0.0%', 'ignored'],
    ['Standard', 'ignored'],
    ['b:', 'ignored'],
    ['', 'none'],
  ])('%j → %s', (raw, status) => {
    expect(attrFormatStatus(raw)).toBe(status);
  });
  it('null → none', () => { expect(attrFormatStatus(null)).toBe('none'); });
});

describe('split / compose', () => {
  it('splits a one-letter prefix only', () => {
    expect(splitAttrFormat('C:0.0')).toEqual({ prefix: 'c', pattern: '0.0' });
    expect(splitAttrFormat('#,##0')).toEqual({ prefix: null, pattern: '#,##0' });
    expect(splitAttrFormat('dd:mm')).toEqual({ prefix: null, pattern: 'dd:mm' });
  });
  it('keeps c:, otherwise writes b:', () => {
    expect(composeAttrFormat('0.0', 'c:#,##0')).toBe('c:0.0');
    expect(composeAttrFormat('0.0', 'd:#,##0')).toBe('b:0.0');
    expect(composeAttrFormat('0.0', null)).toBe('b:0.0');
  });
  it('recognises the attribute cube', () => {
    expect(attrCubeDimension('}ElementAttributes_Konto')).toBe('Konto');
    expect(attrCubeDimension('Konto')).toBeNull();
  });
});
