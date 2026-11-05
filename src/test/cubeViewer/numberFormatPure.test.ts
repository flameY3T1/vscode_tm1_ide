import { describe, it, expect } from 'vitest';
import {
  MDX_DEFAULT_FORMAT, insertGroupSeparators, applyDefaultGrouping,
} from '../../commands/cubeViewer/numberFormatPure';

describe('insertGroupSeparators', () => {
  it('groups the integer part and infers the separator pair from the string', () => {
    expect(insertGroupSeparators('259842568,75')).toBe('259.842.568,75');
    expect(insertGroupSeparators('259842568.75')).toBe('259,842,568.75');
  });

  it('keeps the sign in front of the grouped digits', () => {
    expect(insertGroupSeparators('-1130257322,20')).toBe('-1.130.257.322,20');
  });

  it('leaves TM1s own digits, rounding and decimal separator untouched', () => {
    // three decimals survive — the helper never reformats, it only inserts
    expect(insertGroupSeparators('1234567,890')).toBe('1.234.567,890');
  });

  it('leaves short numbers alone', () => {
    expect(insertGroupSeparators('999,99')).toBe('999,99');
    expect(insertGroupSeparators('0,00')).toBe('0,00');
    expect(insertGroupSeparators('-0,00')).toBe('-0,00');
  });

  it('groups exactly at the thousands boundary', () => {
    expect(insertGroupSeparators('1000,00')).toBe('1.000,00');
    expect(insertGroupSeparators('10000,00')).toBe('10.000,00');
    expect(insertGroupSeparators('100000,00')).toBe('100.000,00');
    expect(insertGroupSeparators('1000000,00')).toBe('1.000.000,00');
  });

  it('returns anything it cannot read unchanged', () => {
    // no decimal separator = no way to tell which character would group
    expect(insertGroupSeparators('1234567')).toBe('1234567');
    expect(insertGroupSeparators('error')).toBe('error');
    expect(insertGroupSeparators('')).toBe('');
    expect(insertGroupSeparators('1.23e+21')).toBe('1.23e+21');
    expect(insertGroupSeparators('N/A')).toBe('N/A');
    // already grouped — a second separator means someone else did the job
    expect(insertGroupSeparators('1.234.567,89')).toBe('1.234.567,89');
  });
});

describe('applyDefaultGrouping', () => {
  it('adds the grouping only for the MDX default format', () => {
    expect(applyDefaultGrouping('259842568,75', MDX_DEFAULT_FORMAT)).toBe('259.842.568,75');
    expect(applyDefaultGrouping('259842568,75', '0.00')).toBe('259.842.568,75');
  });

  it('passes a format the modeller set through verbatim — TM1 rendered it already', () => {
    expect(applyDefaultGrouping('1.167.571.059', '#,##0')).toBe('1.167.571.059');
    expect(applyDefaultGrouping('12,5%', '0.0%')).toBe('12,5%');
  });

  it('passes NativeView output through verbatim — it is grouped already', () => {
    // A NativeView cellset reports '' for exactly the cells an MDX cellset
    // reports '0.00' for, and renders them WITH grouping. Measured live
    // against 11.8 on 780 paired cells: the pairing held without exception.
    expect(applyDefaultGrouping('259.842.568,75', '')).toBe('259.842.568,75');
    expect(applyDefaultGrouping('259.842.568,75', undefined)).toBe('259.842.568,75');
  });
});
