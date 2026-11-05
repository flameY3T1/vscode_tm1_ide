import { describe, it, expect } from 'vitest';
import { getUsageGraphHtml } from '../../references/usageGraphWebview';
import type { UsageRef } from '../../references/callGraph';

const refs: UsageRef[] = [
  { sourceKind: 'subset', sourceName: 'Region:Region:Europe', section: 'subset', line: 0, snippet: '<static>' },
  { sourceKind: 'view',   sourceName: 'Sales:V1',            section: 'view',   line: 0, snippet: 'SELECT ...' },
  { sourceKind: 'process', sourceName: 'LoadRegion',        section: 'prolog', line: 3, snippet: 'DimensionElementInsert(...)' },
];

describe('getUsageGraphHtml — subset/view groups', () => {
  it('emits clickable subset + view groups with their kind', () => {
    const html = getUsageGraphHtml('dimension', 'Region', refs);
    expect(html).toContain('data-kind="subset"');
    expect(html).toContain('data-kind="view"');
    expect(html).toContain('Region:Region:Europe');
    expect(html).toContain('Sales:V1');
  });
  it('summary counts subsets and views', () => {
    const html = getUsageGraphHtml('dimension', 'Region', refs);
    expect(html).toMatch(/1 subsets/);
    expect(html).toMatch(/1 views/);
  });
  it('renders every group collapsed by default (process, rule, subset, view)', () => {
    const html = getUsageGraphHtml('dimension', 'Region', refs);
    expect(html).toContain('class="group collapsed"');
    expect(html).not.toContain('class="group"');
  });

  it('does not use the ugly math subset-of glyph', () => {
    const html = getUsageGraphHtml('dimension', 'Region', refs);
    expect(html).not.toContain('⊂');
  });

  it('subset/view rows omit the meaningless "Zeile 1" meta', () => {
    const html = getUsageGraphHtml('dimension', 'Region', refs);
    expect(html).not.toContain('subset · Zeile');
    expect(html).not.toContain('view · Zeile');
  });
});
