import { describe, it, expect } from 'vitest';
import { mergeFormatConfig } from '../providers/formatConfigStore';
import { DEFAULT_FORMAT_CONFIG } from '../tiLogicVisualizer/formatRules';

describe('mergeFormatConfig', () => {
  it('returns defaults for undefined', () => {
    expect(mergeFormatConfig(undefined)).toEqual(DEFAULT_FORMAT_CONFIG);
  });
  it('overlays stored values and backfills missing rule flags', () => {
    const merged = mergeFormatConfig({ keywordCase: 'lower', enabled: { 'keyword-case': false } } as never);
    expect(merged.keywordCase).toBe('lower');
    expect(merged.enabled['keyword-case']).toBe(false);
    expect(merged.enabled['block-indent']).toBe(true); // backfilled from default
    expect(merged.parenStyle).toBe('tight');
  });
  it('backfills wrapColumn and wrap-long-calls flag for stored configs predating wrap-long-calls', () => {
    const merged = mergeFormatConfig({ keywordCase: 'lower', enabled: { 'keyword-case': false } } as never);
    expect(merged.wrapColumn).toBe(120);
    expect(merged.enabled['wrap-long-calls']).toBe(false);
  });
});
