import { describe, it, expect } from 'vitest';
import { normalizeSection } from '../../../webviewClient/processEditorMonaco/debugPure';

describe('normalizeSection', () => {
  it('passes canonical lowercase values through', () => {
    expect(normalizeSection('prolog')).toBe('prolog');
    expect(normalizeSection('metadata')).toBe('metadata');
    expect(normalizeSection('data')).toBe('data');
    expect(normalizeSection('epilog')).toBe('epilog');
  });

  it('lowercases legacy capitalized values', () => {
    expect(normalizeSection('Prolog')).toBe('prolog');
    expect(normalizeSection('METADATA')).toBe('metadata');
    expect(normalizeSection('Data')).toBe('data');
    expect(normalizeSection('EPILOG')).toBe('epilog');
  });

  // Fix 4: an unknown section must NOT be invented as 'prolog'. The old
  // fallback switched the editor to the Prolog tab and highlighted a line the
  // process was not on whenever the server reported no position.
  it('returns undefined for unknown input instead of guessing prolog', () => {
    expect(normalizeSection('unknown')).toBeUndefined();
    expect(normalizeSection('')).toBeUndefined();
  });

  it('returns undefined for null/undefined/number', () => {
    expect(normalizeSection(null)).toBeUndefined();
    expect(normalizeSection(undefined)).toBeUndefined();
    expect(normalizeSection(42)).toBeUndefined();
  });

  it('coerces non-string input via String()', () => {
    expect(normalizeSection({ toString: () => 'data' })).toBe('data');
  });
});
