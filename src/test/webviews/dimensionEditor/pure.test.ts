import { describe, it, expect } from 'vitest';
import {
  typeSortKey,
  compareByTypeName,
  escapeHtml,
  typeBadgeHtml,
  parseBulkInput,
  validateDimensionState,
} from '../../../webviewClient/dimensionEditor/pure';
import { validateElementName } from '../../../webviewClient/dimensionEditor/validation';
import { findDuplicateNames } from '../../../webviewClient/dimensionEditor/validation';
import { detectCycle } from '../../../webviewClient/dimensionEditor/validation';

describe('typeBadgeHtml', () => {
  it('wraps a normal type in a badge span', () => {
    expect(typeBadgeHtml('N')).toBe('<span class="type-badge">N</span>');
  });
  it('escapes the type value (no raw markup injection)', () => {
    const html = typeBadgeHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('typeSortKey', () => {
  it('C=0, N=1, S=2, other=3', () => {
    expect(typeSortKey({ type: 'C' })).toBe(0);
    expect(typeSortKey({ type: 'N' })).toBe(1);
    expect(typeSortKey({ type: 'S' })).toBe(2);
    expect(typeSortKey({ type: 'X' })).toBe(3);
    expect(typeSortKey({})).toBe(3);
  });
});

describe('compareByTypeName', () => {
  it('sorts by type first', () => {
    expect(compareByTypeName({ name: 'b', type: 'C' }, { name: 'a', type: 'N' })).toBeLessThan(0);
    expect(compareByTypeName({ name: 'a', type: 'S' }, { name: 'z', type: 'N' })).toBeGreaterThan(0);
  });
  it('within type, sorts by name (locale)', () => {
    expect(compareByTypeName({ name: 'a', type: 'N' }, { name: 'b', type: 'N' })).toBeLessThan(0);
    expect(compareByTypeName({ name: 'b', type: 'N' }, { name: 'a', type: 'N' })).toBeGreaterThan(0);
  });
  it('returns 0 for identical', () => {
    expect(compareByTypeName({ name: 'x', type: 'N' }, { name: 'x', type: 'N' })).toBe(0);
  });
});

describe('escapeHtml', () => {
  it('escapes all five chars', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#039;f');
  });
  it('coerces non-string', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
});

describe('validateElementName', () => {
  it('returns null for valid name', () => {
    expect(validateElementName('Product')).toBeNull();
    expect(validateElementName('Item_123')).toBeNull();
  });
  it('returns "empty" for empty/whitespace', () => {
    expect(validateElementName('')).toBe('empty');
    expect(validateElementName('   ')).toBe('empty');
    expect(validateElementName('\t\n')).toBe('empty');
  });
  it('returns "invalid-char" for quotes/brackets/control', () => {
    expect(validateElementName("a'b")).toBe('invalid-char');
    expect(validateElementName('a[b')).toBe('invalid-char');
    expect(validateElementName('a]b')).toBe('invalid-char');
    expect(validateElementName('a\x00b')).toBe('invalid-char');
    expect(validateElementName('a\tb')).toBe('invalid-char');
  });
});

describe('findDuplicateNames', () => {
  it('returns empty for unique names', () => {
    expect(findDuplicateNames(['a', 'b', 'c'])).toEqual([]);
  });
  it('groups case-insensitive duplicates', () => {
    expect(findDuplicateNames(['A', 'a', 'B'])).toEqual([['A', 'a']]);
  });
  it('handles multiple groups', () => {
    const out = findDuplicateNames(['X', 'x', 'Y', 'y', 'Z']);
    expect(out.length).toBe(2);
  });
  it('skips singletons', () => {
    expect(findDuplicateNames(['only'])).toEqual([]);
  });
});

describe('detectCycle', () => {
  it('returns false for empty edges', () => {
    expect(detectCycle([])).toBe(false);
  });
  it('returns false for tree (no cycle)', () => {
    expect(detectCycle([
      { parent: 'root', child: 'a' },
      { parent: 'root', child: 'b' },
      { parent: 'a', child: 'a1' },
    ])).toBe(false);
  });
  it('returns true for self-loop', () => {
    expect(detectCycle([{ parent: 'x', child: 'x' }])).toBe(true);
  });
  it('returns true for 2-cycle', () => {
    expect(detectCycle([
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a' },
    ])).toBe(true);
  });
  it('returns true for 3-cycle', () => {
    expect(detectCycle([
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'c' },
      { parent: 'c', child: 'a' },
    ])).toBe(true);
  });
  it('ignores edges marked deleted', () => {
    expect(detectCycle([
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a', marked: 'deleted' },
    ])).toBe(false);
  });
  it('detects cycle in DAG with multiple components', () => {
    expect(detectCycle([
      { parent: 'x', child: 'y' },
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'a' },
    ])).toBe(true);
  });
});

describe('parseBulkInput', () => {
  it('returns empty for empty input', () => {
    expect(parseBulkInput('', new Set())).toEqual({
      valid: [], duplicateFile: [], alreadyExists: [], invalid: [],
    });
  });
  it('classifies each line', () => {
    const existing = new Set(['existing']);
    const text = 'NewOne\nNewTwo\nExisting\nDup\nDup\nbad[name\n  \n';
    const out = parseBulkInput(text, existing);
    expect(out.valid).toEqual(['NewOne', 'NewTwo', 'Dup']);
    expect(out.alreadyExists).toEqual(['Existing']);
    expect(out.duplicateFile).toEqual(['Dup']);
    expect(out.invalid).toEqual(['bad[name']);
  });
  it('case-insensitive duplicate detection within input', () => {
    const out = parseBulkInput('A\na', new Set());
    expect(out.valid).toEqual(['A']);
    expect(out.duplicateFile).toEqual(['a']);
  });
  it('case-insensitive alreadyExists check', () => {
    const out = parseBulkInput('FOO', new Set(['foo']));
    expect(out.alreadyExists).toEqual(['FOO']);
  });
  it('handles CRLF line endings', () => {
    const out = parseBulkInput('a\r\nb', new Set());
    expect(out.valid).toEqual(['a', 'b']);
  });
  it('trims whitespace', () => {
    const out = parseBulkInput('  spaced  \n\t\t', new Set());
    expect(out.valid).toEqual(['spaced']);
  });
});

describe('validateDimensionState', () => {
  it('returns empty for valid state', () => {
    expect(validateDimensionState(
      [{ name: 'A', type: 'N' }, { name: 'B', type: 'C' }],
      [{ parent: 'B', child: 'A' }],
    )).toEqual([]);
  });
  it('reports duplicates', () => {
    const errors = validateDimensionState(
      [{ name: 'A' }, { name: 'a' }],
      [],
    );
    expect(errors).toContain('duplicates');
  });
  it('reports empty name', () => {
    const errors = validateDimensionState([{ name: '' }, { name: 'ok' }], []);
    expect(errors).toContain('emptyElementName');
  });
  it('reports invalid characters', () => {
    const errors = validateDimensionState([{ name: "bad'name" }], []);
    expect(errors.some((e) => e.includes('invalidCharsValue'))).toBe(true);
  });
  it('reports cycle', () => {
    const errors = validateDimensionState(
      [{ name: 'a' }, { name: 'b' }],
      [{ parent: 'a', child: 'b' }, { parent: 'b', child: 'a' }],
    );
    expect(errors).toContain('cycleInConsolidations');
  });
  it('excludes elements marked deleted from validation', () => {
    const errors = validateDimensionState(
      [{ name: '', marked: 'deleted' }, { name: 'ok' }],
      [],
    );
    expect(errors).not.toContain('emptyElementName');
  });
  it('aggregates multiple error types', () => {
    const errors = validateDimensionState(
      [{ name: 'A' }, { name: 'a' }, { name: '' }],
      [{ parent: 'x', child: 'x' }],
    );
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
