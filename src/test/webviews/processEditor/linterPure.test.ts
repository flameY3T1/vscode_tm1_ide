import { describe, it, expect } from 'vitest';
import {
  stripRuleIdPrefix,
  escapeHtml,
  severityToMarker,
  mergedSection,
  flattenDiagnostics,
  applySeverityFilter,
  SECTION_ORDER,
  SECTION_LABELS,
  type SectionKey,
  type FlatItem,
} from '../../../webviewClient/processEditorMonaco/linterPure';
import type { LintDiagnose } from '../../../tiLogicVisualizer/lintTypes';

const diag = (
  line: number,
  severity: LintDiagnose['severity'],
  message: string,
  ruleId = 'rule-x',
): LintDiagnose => ({ line, severity, message, ruleId, column: 1 } as LintDiagnose);

const emptyPerSection = (): Record<SectionKey, LintDiagnose[]> => ({
  prolog: [], metadata: [], data: [], epilog: [],
});

describe('stripRuleIdPrefix', () => {
  it('removes [rule-id] prefix with trailing whitespace', () => {
    expect(stripRuleIdPrefix('[no-foo] avoid foo')).toBe('avoid foo');
    expect(stripRuleIdPrefix('[rule-x]\tabc')).toBe('abc');
  });
  it('leaves messages without prefix unchanged', () => {
    expect(stripRuleIdPrefix('plain message')).toBe('plain message');
  });
  it('only strips the leading prefix, preserves later brackets', () => {
    expect(stripRuleIdPrefix('[a] hi [b]')).toBe('hi [b]');
  });
  it('handles empty string', () => {
    expect(stripRuleIdPrefix('')).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes &, <, >', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
  it('escapes quotes (MT2 consolidation: defense-in-depth)', () => {
    expect(escapeHtml('"abc"')).toBe('&quot;abc&quot;');
  });
  it('passes safe input through', () => {
    expect(escapeHtml('PlainText_2024')).toBe('PlainText_2024');
  });
});

describe('severityToMarker', () => {
  it('error -> 8', () => {
    expect(severityToMarker('error')).toBe(8);
  });
  it('warning -> 4', () => {
    expect(severityToMarker('warning')).toBe(4);
  });
  it('info -> 2 (Info)', () => {
    expect(severityToMarker('info')).toBe(2);
  });
  it('hint/other -> 1 (Hint)', () => {
    expect(severityToMarker('hint' as LintDiagnose['severity'])).toBe(1);
  });
});

describe('mergedSection', () => {
  it('returns empty when all streams are empty', () => {
    expect(mergedSection('prolog', emptyPerSection(), emptyPerSection(), emptyPerSection())).toEqual([]);
  });
  it('preserves order: main -> server -> compile', () => {
    const main = emptyPerSection();
    const server = emptyPerSection();
    const compile = emptyPerSection();
    main.prolog = [diag(1, 'error', 'M1')];
    server.prolog = [diag(2, 'warning', 'S1')];
    compile.prolog = [diag(3, 'error', 'C1')];
    const out = mergedSection('prolog', main, server, compile);
    expect(out.map((d) => d.message)).toEqual(['M1', 'S1', 'C1']);
  });
});

describe('flattenDiagnostics', () => {
  it('returns empty for empty input', () => {
    expect(flattenDiagnostics(emptyPerSection())).toEqual([]);
  });
  it('sorts by SECTION_ORDER then line', () => {
    const per = emptyPerSection();
    per.data = [diag(5, 'error', 'd5'), diag(1, 'warning', 'd1')];
    per.prolog = [diag(10, 'info', 'p10'), diag(2, 'error', 'p2')];
    per.epilog = [diag(1, 'error', 'e1')];
    const out = flattenDiagnostics(per);
    expect(out.map((i) => `${i.section}:${i.line}`)).toEqual([
      'prolog:2', 'prolog:10', 'data:1', 'data:5', 'epilog:1',
    ]);
  });
  it('strips rule-id prefix from message', () => {
    const per = emptyPerSection();
    per.prolog = [diag(1, 'error', '[my-rule] failure here')];
    expect(flattenDiagnostics(per)[0].message).toBe('failure here');
  });
  it('populates sectionLabel from SECTION_LABELS', () => {
    const per = emptyPerSection();
    per.metadata = [diag(1, 'error', 'x')];
    expect(flattenDiagnostics(per)[0].sectionLabel).toBe(SECTION_LABELS.metadata);
  });
  it('preserves ruleId verbatim (no strip on ruleId field)', () => {
    const per = emptyPerSection();
    per.prolog = [diag(1, 'error', '[abc] msg', 'rule-abc')];
    expect(flattenDiagnostics(per)[0].ruleId).toBe('rule-abc');
  });
});

describe('applySeverityFilter', () => {
  const items: FlatItem[] = [
    { section: 'prolog', sectionLabel: 'Prolog', line: 1, severity: 'error', message: 'e', ruleId: 'r1' },
    { section: 'prolog', sectionLabel: 'Prolog', line: 2, severity: 'warning', message: 'w', ruleId: 'r2' },
    { section: 'data', sectionLabel: 'Data', line: 3, severity: 'info', message: 'i', ruleId: 'r3' },
  ];
  it('passes everything when filter is "all"', () => {
    expect(applySeverityFilter(items, 'all')).toHaveLength(3);
  });
  it('filters down to error only', () => {
    const out = applySeverityFilter(items, 'error');
    expect(out.map((i) => i.severity)).toEqual(['error']);
  });
  it('filters down to warning only', () => {
    expect(applySeverityFilter(items, 'warning').map((i) => i.line)).toEqual([2]);
  });
  it('returns empty when no items match filter', () => {
    expect(applySeverityFilter([], 'error')).toEqual([]);
  });
});

describe('SECTION_ORDER + SECTION_LABELS', () => {
  it('has 4 sections in canonical order', () => {
    expect(SECTION_ORDER).toEqual(['prolog', 'metadata', 'data', 'epilog']);
  });
  it('every section key has a German label', () => {
    for (const key of SECTION_ORDER) {
      expect(SECTION_LABELS[key]).toBeTruthy();
    }
  });
});
