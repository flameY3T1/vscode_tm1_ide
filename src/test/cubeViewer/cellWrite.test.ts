import { describe, it, expect } from 'vitest';
import {
  buildCoordinates, parseEditedValue, parseStringCellValue, classifyWriteError, normalizeDecimal,
} from '../../cubeViewer/cellWrite';

describe('buildCoordinates', () => {
  it('2D cube: 1 row dim + 1 col dim, no titles', () => {
    const coords = buildCoordinates({
      cubeDims: ['Month', 'Account'],
      rowDims: ['Month'],
      colDims: ['Account'],
      rowTuples: [['Jan'], ['Feb'], ['Mar']],
      colTuples: [['Sales'], ['Profit']],
      ri: 1,
      ci: 0,
      titleAssignments: {},
    });
    expect(coords).toEqual(['Feb', 'Sales']);
  });

  it('3D cube: 1 row + 1 col + 1 title', () => {
    const coords = buildCoordinates({
      cubeDims: ['Month', 'Region', 'Account'],
      rowDims: ['Month'],
      colDims: ['Account'],
      rowTuples: [['Jan']],
      colTuples: [['Sales']],
      ri: 0,
      ci: 0,
      titleAssignments: { Region: 'Europe' },
    });
    expect(coords).toEqual(['Jan', 'Europe', 'Sales']);
  });

  it('multi-dim row axis: tuple order matches rowDims', () => {
    const coords = buildCoordinates({
      cubeDims: ['Year', 'Month', 'Account'],
      rowDims: ['Year', 'Month'],
      colDims: ['Account'],
      rowTuples: [['2025', 'Feb']],
      colTuples: [['Sales']],
      ri: 0,
      ci: 0,
      titleAssignments: {},
    });
    expect(coords).toEqual(['2025', 'Feb', 'Sales']);
  });

  it('throws when a cube dim is neither on axes nor in titleAssignments', () => {
    expect(() => buildCoordinates({
      cubeDims: ['Month', 'Region', 'Account'],
      rowDims: ['Month'],
      colDims: ['Account'],
      rowTuples: [['Jan']],
      colTuples: [['Sales']],
      ri: 0, ci: 0,
      titleAssignments: {},   // missing Region
    })).toThrowError(/Region/);
  });
});

describe('parseEditedValue', () => {
  it('empty → empty', () => {
    expect(parseEditedValue('')).toEqual({ kind: 'empty', payload: '' });
    expect(parseEditedValue('   ')).toEqual({ kind: 'empty', payload: '' });
  });

  it('plain numeric → numeric', () => {
    expect(parseEditedValue('42')).toEqual({ kind: 'numeric', payload: 42 });
    expect(parseEditedValue('3.14')).toEqual({ kind: 'numeric', payload: 3.14 });
    expect(parseEditedValue('-10')).toEqual({ kind: 'numeric', payload: -10 });
  });

  it('leading minus + digits → numeric (negative value), NOT spreading', () => {
    expect(parseEditedValue('-100')).toEqual({ kind: 'numeric', payload: -100 });
    expect(parseEditedValue('-3.14')).toEqual({ kind: 'numeric', payload: -3.14 });
  });

  it('tilde → spreading (clear)', () => {
    expect(parseEditedValue('~')).toEqual({ kind: 'spreading', payload: '~' });
  });

  it('+N, *N → spreading (passthrough)', () => {
    expect(parseEditedValue('+100')).toEqual({ kind: 'spreading', payload: '+100' });
    expect(parseEditedValue('*1.5')).toEqual({ kind: 'spreading', payload: '*1.5' });
  });

  it('non-numeric string → string', () => {
    expect(parseEditedValue('Hello')).toEqual({ kind: 'string', payload: 'Hello' });
  });

  it('trims whitespace', () => {
    expect(parseEditedValue('  42  ')).toEqual({ kind: 'numeric', payload: 42 });
    expect(parseEditedValue('  Hello  ')).toEqual({ kind: 'string', payload: 'Hello' });
  });
});

describe('classifyWriteError', () => {
  it('400 → validation', () => {
    const r = classifyWriteError(400, '{"error":{"message":"Bad value"}}');
    expect(r.kind).toBe('validation');
    expect(r.message).toContain('Bad value');
  });

  it('403 → security', () => {
    const r = classifyWriteError(403, '{"error":{"message":"Access denied"}}');
    expect(r.kind).toBe('security');
    expect(r.message).toContain('Access denied');
  });

  it('401 → auth, not server', () => {
    expect(classifyWriteError(401, '').kind).toBe('auth');
  });

  it('5xx → server', () => {
    const r = classifyWriteError(500, 'internal');
    expect(r.kind).toBe('server');
  });

  it('0 → network', () => {
    const r = classifyWriteError(0, '');
    expect(r.kind).toBe('network');
  });
});

describe('classifyWriteError — new kinds for spreading', () => {
  it('maps HTTP 400 with DataSpreadFailed payload to spread-failed', () => {
    const body = JSON.stringify({ error: { message: 'DataSpreadFailed', code: 'DataSpreadFailed' } });
    expect(classifyWriteError(400, body).kind).toBe('spread-failed');
  });

  it('maps HTTP 400 with message containing "DataSpreadFailed" to spread-failed', () => {
    const body = JSON.stringify({ error: { message: 'Spread refused: DataSpreadFailed at leaf.' } });
    expect(classifyWriteError(400, body).kind).toBe('spread-failed');
  });

  it('keeps plain 400 without DataSpreadFailed as validation', () => {
    const body = JSON.stringify({ error: { message: 'Invalid tuple' } });
    expect(classifyWriteError(400, body).kind).toBe('validation');
  });

  it('maps HTTP 404 to not-found', () => {
    expect(classifyWriteError(404, '').kind).toBe('not-found');
  });

  it('preserves existing mappings for 403 / 500 / 0', () => {
    expect(classifyWriteError(403, '').kind).toBe('security');
    expect(classifyWriteError(500, '').kind).toBe('server');
    expect(classifyWriteError(0, '').kind).toBe('network');
  });
});

describe('normalizeDecimal', () => {
  it('comma mode: dot groups, comma separates', () => {
    expect(normalizeDecimal('1.234,50', true)).toBe('1234.50');
    expect(normalizeDecimal('1234,5', true)).toBe('1234.5');
    expect(normalizeDecimal('1.234.567', true)).toBe('1234567');
  });

  it('dot mode: comma groups, dot separates', () => {
    expect(normalizeDecimal('1,234.50', false)).toBe('1234.50');
    expect(normalizeDecimal('1234.5', false)).toBe('1234.5');
    expect(normalizeDecimal('1,234,567', false)).toBe('1234567');
  });

  it('leaves spread tokens untouched', () => {
    expect(normalizeDecimal('~', true)).toBe('~');
    expect(normalizeDecimal('+100', true)).toBe('+100');
    expect(normalizeDecimal('*1,5', true)).toBe('*1,5');
  });

  it('leaves text untouched', () => {
    expect(normalizeDecimal('Kommentar, mit Komma', true)).toBe('Kommentar, mit Komma');
    expect(normalizeDecimal('', true)).toBe('');
  });

  it('negative numbers stay negative', () => {
    expect(normalizeDecimal('-1.234,50', true)).toBe('-1234.50');
  });

  // The round trip that breaks today: Ctrl+C outputs `1234,50` in comma mode.
  it('accepts what Ctrl+C outputs', () => {
    expect(parseEditedValue(normalizeDecimal('1234,50', true))).toEqual({ kind: 'numeric', payload: 1234.5 });
  });

  // Regression: the grouping character may only go away when real groups of three
  // follow — otherwise a short fractional part is wrongly multiplied by ten.
  it('comma mode: strips only REAL groups of three', () => {
    expect(normalizeDecimal('1.234', true)).toBe('1234');
    expect(normalizeDecimal('1.234.567', true)).toBe('1234567');
    expect(normalizeDecimal('1.234,50', true)).toBe('1234.50');
    expect(normalizeDecimal('1.5', true)).toBe('1.5');
    expect(normalizeDecimal('1.23', true)).toBe('1.23');
    expect(normalizeDecimal('12.3', true)).toBe('12.3');
    expect(normalizeDecimal('1.2345', true)).toBe('1.2345');
    expect(normalizeDecimal('1234,5', true)).toBe('1234.5');
    expect(normalizeDecimal('-1.234,50', true)).toBe('-1234.50');
  });

  it('dot mode: strips only REAL groups of three', () => {
    expect(normalizeDecimal('1,234', false)).toBe('1234');
    expect(normalizeDecimal('1,234.50', false)).toBe('1234.50');
    expect(normalizeDecimal('1234.5', false)).toBe('1234.5');
    expect(normalizeDecimal('1,5', false)).toBe('1,5');
  });

  it('dot mode: "1,5" stays untouched and is classified as a string', () => {
    expect(parseEditedValue(normalizeDecimal('1,5', false))).toEqual({ kind: 'string', payload: '1,5' });
  });
});

describe('parseStringCellValue', () => {
  it('keeps number-looking input as text, never spreading', () => {
    expect(parseStringCellValue(' 01223 ')).toEqual({ kind: 'string', payload: '01223' });
    expect(parseStringCellValue('-5')).toEqual({ kind: 'string', payload: '-5' });
    expect(parseStringCellValue('~')).toEqual({ kind: 'string', payload: '~' });
    expect(parseStringCellValue('  ')).toEqual({ kind: 'empty', payload: '' });
  });
});
