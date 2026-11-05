import { describe, it, expect } from 'vitest';
import { applyDecimalSeparator, usesCommaDecimal } from '../webviewClient/cubeViewerMonaco/decimalSepPure';

/**
 * The examples come from the live measurement in `numberFormatPure.ts`
 * (TM1 11.8, 2026-08-08): `1.167.571.059` without decimal places and
 * `259.842.568,75` with — both in German convention.
 */
describe('usesCommaDecimal', () => {
  it('recognizes a purely grouped number by the multiple dots', () => {
    expect(usesCommaDecimal('1.167.571.059', undefined)).toBe(true);
  });

  it('with both characters, takes the last one as the decimal separator', () => {
    expect(usesCommaDecimal('259.842.568,75', undefined)).toBe(true);
    expect(usesCommaDecimal('1,234.56', undefined)).toBe(false);
  });

  it('recognizes a decimal point by a fraction length other than three', () => {
    expect(usesCommaDecimal('1.23', undefined)).toBe(false);
    expect(usesCommaDecimal('1,5', undefined)).toBe(true);
    expect(usesCommaDecimal('1.23456', undefined)).toBe(false);
  });

  it('with exactly three fraction digits, lets the raw value decide', () => {
    expect(usesCommaDecimal('1.234', '1234')).toBe(true);   // thousands group
    expect(usesCommaDecimal('1.234', '1.234')).toBe(false); // real decimal places
    expect(usesCommaDecimal('1,234', '1234')).toBe(false);
    expect(usesCommaDecimal('1,234', '1.234')).toBe(true);
  });

  it('swaps the number inside a FORMAT_STRING text (unit, brackets, scale) — live 11.8', () => {
    expect(applyDecimalSeparator('533.318 €', '533317.61', false)).toBe('533,318 €');
    expect(applyDecimalSeparator('(1.234.567 €)', '-1234567.375', false)).toBe('(1,234,567 €)');
    expect(applyDecimalSeparator('-123.456.737,50 %', '-1234567.375', false)).toBe('-123,456,737.50 %');
    expect(applyDecimalSeparator('1.235k', '1234567', false)).toBe('1,235k');
    expect(applyDecimalSeparator('533.318 €', '533317.61', true)).toBe('533.318 €');
  });

  it('leaves text cells and dates alone', () => {
    expect(applyDecimalSeparator('Version 2.1', 'Version 2.1', true)).toBe('Version 2.1');
    expect(applyDecimalSeparator('15.03.2023', '45000', false)).toBe('15.03.2023');
  });

  it('reads a separator with more than three digits in front as the decimal one (format 0.000, live 11.8)', () => {
    expect(usesCommaDecimal('-1234567,375', '-1234567.375')).toBe(true);
    expect(usesCommaDecimal('1234567.375', '1234567.375')).toBe(false);
    expect(applyDecimalSeparator('-1234567,375', '-1234567.375', true)).toBe('-1234567,375');
    expect(applyDecimalSeparator('-1234567,375', '-1234567.375', false)).toBe('-1234567.375');
  });

  it('without a raw value, takes the thousands group as the more frequent case', () => {
    expect(usesCommaDecimal('1.234', undefined)).toBe(true);
  });

  it('says nothing about a number without separators', () => {
    expect(usesCommaDecimal('1234', '1234')).toBeNull();
  });
});

describe('applyDecimalSeparator', () => {
  it('converts a grouped integer — the case that was left lying so far', () => {
    expect(applyDecimalSeparator('1.167.571.059', undefined, false)).toBe('1,167,571,059');
    expect(applyDecimalSeparator('1.167.571.059', undefined, true)).toBe('1.167.571.059');
  });

  it('converts grouping and decimal places together', () => {
    expect(applyDecimalSeparator('259.842.568,75', undefined, false)).toBe('259,842,568.75');
    expect(applyDecimalSeparator('1,234.56', undefined, true)).toBe('1.234,56');
  });

  it('keeps the sign and a percent suffix', () => {
    expect(applyDecimalSeparator('-1.234,5', undefined, false)).toBe('-1,234.5');
    expect(applyDecimalSeparator('12,3%', undefined, false)).toBe('12.3%');
  });

  it('leaves a number without separators alone', () => {
    expect(applyDecimalSeparator('1234', '1234', true)).toBe('1234');
    expect(applyDecimalSeparator('0', '0', false)).toBe('0');
  });

  it('does not touch text', () => {
    expect(applyDecimalSeparator('Summe a.b,c', undefined, false)).toBe('Summe a.b,c');
    expect(applyDecimalSeparator('N/A', undefined, true)).toBe('N/A');
    expect(applyDecimalSeparator('', undefined, true)).toBe('');
  });

  it('changes nothing when the number already stands like that', () => {
    expect(applyDecimalSeparator('1.234,56', undefined, true)).toBe('1.234,56');
    expect(applyDecimalSeparator('1,234.56', undefined, false)).toBe('1,234.56');
  });
});
