import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  liveSpan,
  rowMatches,
  SECTION_LABELS,
  type ResolverRow,
} from '../../../webviewClient/processEditorMonaco/resolverPure';

describe('SECTION_LABELS', () => {
  it('maps all four sections', () => {
    expect(SECTION_LABELS.prolog).toBe('Prolog');
    expect(SECTION_LABELS.metadata).toBe('Metadata');
    expect(SECTION_LABELS.data).toBe('Data');
    expect(SECTION_LABELS.epilog).toBe('Epilog');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SECTION_LABELS)).toBe(true);
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('liveSpan', () => {
  it('wraps escaped value in styled span', () => {
    expect(liveSpan('42')).toBe(' <span class="resolver-arg-live">= 42</span>');
  });

  it('HTML-escapes the value', () => {
    expect(liveSpan('<x>')).toContain('= &lt;x&gt;');
  });

  it('handles empty value', () => {
    expect(liveSpan('')).toBe(' <span class="resolver-arg-live">= </span>');
  });
});

describe('rowMatches', () => {
  const baseRow: ResolverRow = {
    section: 'prolog',
    line: 42,
    funcName: 'CellPutN',
    args: [
      { name: 'cube', raw: 'Sales', kind: 'literal', display: 'Sales' },
      { name: 'value', raw: 'pAmount', kind: 'param', display: '100', parts: [
        { identifier: 'pAmount', kind: 'param', display: '100' },
      ]},
    ],
  };

  it('returns true for empty needle', () => {
    expect(rowMatches(baseRow, '')).toBe(true);
  });

  it('matches funcName case-insensitively', () => {
    expect(rowMatches(baseRow, 'cellputn')).toBe(true);
  });

  it('matches section label', () => {
    expect(rowMatches(baseRow, 'prolog')).toBe(true);
  });

  it('matches line number', () => {
    expect(rowMatches(baseRow, '42')).toBe(true);
    expect(rowMatches(baseRow, '4')).toBe(true);
  });

  it('matches arg name', () => {
    expect(rowMatches(baseRow, 'cube')).toBe(true);
  });

  it('matches arg raw value', () => {
    expect(rowMatches(baseRow, 'sales')).toBe(true);
  });

  it('matches arg display value', () => {
    expect(rowMatches(baseRow, '100')).toBe(true);
  });

  it('matches arg part identifier', () => {
    expect(rowMatches(baseRow, 'pamount')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(rowMatches(baseRow, 'nonexistent')).toBe(false);
  });

  it('handles row without arg parts', () => {
    const r: ResolverRow = { ...baseRow, args: [{ name: 'x', raw: 'y', kind: 'literal', display: 'y' }] };
    expect(rowMatches(r, 'y')).toBe(true);
    expect(rowMatches(r, 'z')).toBe(false);
  });

  it('matches Metadata section label', () => {
    const r: ResolverRow = { ...baseRow, section: 'metadata' };
    expect(rowMatches(r, 'metadata')).toBe(true);
  });
});
