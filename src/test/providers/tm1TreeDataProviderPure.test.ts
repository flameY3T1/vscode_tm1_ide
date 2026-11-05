import { describe, it, expect } from 'vitest';
import {
  filterByName,
  resolveProcessGroupConfig,
  formatTreeError,
} from '../../providers/tm1TreeDataProviderPure';
import { DEFAULT_PROCESS_GROUP_MODE } from '../../providers/processGroupingPure';

describe('filterByName', () => {
  it('passes all when no filter active', () => {
    expect(filterByName('Plan', false, '')).toBe(true);
    expect(filterByName('}Stats', false, '')).toBe(true);
  });
  it('hides system objects (} prefix) when hideSystem=true', () => {
    expect(filterByName('}Stats', true, '')).toBe(false);
    expect(filterByName('Plan', true, '')).toBe(true);
  });
  it('substring filter is case-insensitive', () => {
    expect(filterByName('SalesPlan', false, 'plan')).toBe(true);
    expect(filterByName('SalesPlan', false, 'PLAN')).toBe(true);
    expect(filterByName('Other', false, 'plan')).toBe(false);
  });
  it('combines hideSystem and filter', () => {
    expect(filterByName('}SystemPlan', true, 'plan')).toBe(false);
    expect(filterByName('Plan', true, 'plan')).toBe(true);
    expect(filterByName('Other', true, 'plan')).toBe(false);
  });
  it('empty name passes empty filter', () => {
    expect(filterByName('', false, '')).toBe(true);
  });
});

describe('resolveProcessGroupConfig', () => {
  const MODE = DEFAULT_PROCESS_GROUP_MODE;

  it('yields no grouping when no override map is passed', () => {
    expect(resolveProcessGroupConfig(undefined, undefined, undefined, MODE))
      .toEqual({ token: '', mode: 'suffix' });
  });
  it('yields no grouping for a server without an override', () => {
    const out = resolveProcessGroupConfig('dev', { prod: '!!' }, { prod: 'prefix' }, MODE);
    expect(out).toEqual({ token: '', mode: 'suffix' });
  });
  it('per-server token override is the only way to get grouping', () => {
    const out = resolveProcessGroupConfig('prod', { prod: '!!' }, undefined, MODE);
    expect(out.token).toBe('!!');
  });
  it('per-server empty-string override means no grouping, same as no override', () => {
    const out = resolveProcessGroupConfig('prod', { prod: '' }, undefined, MODE);
    expect(out.token).toBe('');
  });
  it('an undefined serverKey skips the per-server lookup entirely', () => {
    const out = resolveProcessGroupConfig(undefined, { prod: '!!' }, { prod: 'prefix' }, MODE);
    expect(out).toEqual({ token: '', mode: 'suffix' });
  });
  it('per-server mode override wins over the default mode', () => {
    const out = resolveProcessGroupConfig('prod', undefined, { prod: 'prefix' }, MODE);
    expect(out.mode).toBe('prefix');
  });
  it('invalid per-server mode falls back to the default mode', () => {
    // An explicit per-server key wins even when the value is invalid; the invalid
    // value is treated as "no opinion" within that branch and the default applies.
    const out = resolveProcessGroupConfig('prod', undefined, { prod: 'invalid' }, MODE);
    expect(out.mode).toBe('suffix');
  });
  it('there is no default token — only a default mode for the dialog prefill', () => {
    expect(DEFAULT_PROCESS_GROUP_MODE).toBe('suffix');
    expect(resolveProcessGroupConfig('any', {}, {}, MODE).token).toBe('');
  });
});

describe('formatTreeError', () => {
  it('returns Timeout message when err.message includes "Timeout"', () => {
    expect(formatTreeError({ message: 'Timeout after 30s' })).toBe('Timeout — is the server reachable?');
  });
  it('returns err.message verbatim for non-timeout errors', () => {
    expect(formatTreeError({ message: 'Connection refused' })).toBe('Connection refused');
  });
  it('falls back for missing/null err or message', () => {
    expect(formatTreeError(null)).toBe('Unknown error');
    expect(formatTreeError({})).toBe('Unknown error');
    expect(formatTreeError({ message: 42 })).toBe('Unknown error');
  });
  it('handles undefined gracefully', () => {
    expect(formatTreeError(undefined)).toBe('Unknown error');
  });
});
