import { describe, it, expect } from 'vitest';
import { escapeTiLiteral, TiLiteralError } from '../../utils/tiLiteral';

// Control characters deliberately via fromCharCode instead of escape sequences in the source.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const DEL = String.fromCharCode(127);

describe('escapeTiLiteral', () => {
  it('leaves a plain name unchanged', () => {
    expect(escapeTiLiteral('Sales Cube 123')).toBe('Sales Cube 123');
  });

  it('doubles single quotes', () => {
    expect(escapeTiLiteral("O'Brien")).toBe("O''Brien");
    expect(escapeTiLiteral("Dep't 'X'")).toBe("Dep''t ''X''");
  });

  it('keeps the empty string', () => {
    expect(escapeTiLiteral('')).toBe('');
  });

  it('rejects a newline (would break the TI statement)', () => {
    expect(() => escapeTiLiteral('Sales' + LF + 'ProcessQuit;')).toThrow(TiLiteralError);
    expect(() => escapeTiLiteral('Sales' + LF + 'ProcessQuit;')).toThrow(/U\+000A/);
    expect(() => escapeTiLiteral('Sales' + CR + LF + 'ProcessQuit;')).toThrow(/U\+000D/);
  });

  it('rejects control characters', () => {
    expect(() => escapeTiLiteral('Sales' + NUL + 'Cube')).toThrow(/U\+0000/);
    expect(() => escapeTiLiteral('Sales' + TAB + 'Cube')).toThrow(/U\+0009/);
    expect(() => escapeTiLiteral('Sales' + DEL + 'Cube')).toThrow(/U\+007F/);
  });

  it('does not touch characters that are special in other grammars', () => {
    expect(escapeTiLiteral('Sales]EU')).toBe('Sales]EU');
  });
});
