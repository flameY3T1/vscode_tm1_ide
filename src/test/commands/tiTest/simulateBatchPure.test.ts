import { describe, it, expect } from 'vitest';
import {
  isMeaningfulWarning,
  filterMeaningfulWarnings,
} from '../../../commands/tiTest/simulateBatchPure';

describe('isMeaningfulWarning', () => {
  it('returns false for LogOutput cosmetic warning', () => {
    expect(isMeaningfulWarning("unsupported call 'LogOutput' at prolog:14")).toBe(false);
  });

  it('returns false for ExecuteProcess simulator-skip warning', () => {
    expect(isMeaningfulWarning('ExecuteProcess not executed by simulator (use sub capture)')).toBe(false);
  });

  it('returns false for RunProcess simulator-skip warning', () => {
    expect(isMeaningfulWarning('RunProcess not executed by simulator')).toBe(false);
  });

  it('returns true for arbitrary user-facing warning', () => {
    expect(isMeaningfulWarning('Cell put on consolidated element ignored')).toBe(true);
  });

  it('returns true for empty string (no pattern matches)', () => {
    expect(isMeaningfulWarning('')).toBe(true);
  });

  it('matches LogOutput pattern anywhere in the message', () => {
    expect(isMeaningfulWarning("prolog:5 — unsupported call 'LogOutput' (debug)")).toBe(false);
  });

  it('is case-sensitive — `logoutput` (lower) stays meaningful', () => {
    expect(isMeaningfulWarning("unsupported call 'logoutput'")).toBe(true);
  });

  it('does not match similar but different calls (e.g. LogOutputToFile)', () => {
    expect(isMeaningfulWarning("unsupported call 'LogOutputToFile'")).toBe(true);
  });
});

describe('filterMeaningfulWarnings', () => {
  it('returns [] for empty input', () => {
    expect(filterMeaningfulWarnings([])).toEqual([]);
  });

  it('strips all 3 cosmetic patterns from a mixed list', () => {
    const input = [
      "unsupported call 'LogOutput' at prolog:14",
      'Cell put on consolidated element ignored',
      'ExecuteProcess not executed by simulator',
      'real problem A',
      'RunProcess not executed by simulator',
      'real problem B',
    ];
    expect(filterMeaningfulWarnings(input)).toEqual([
      'Cell put on consolidated element ignored',
      'real problem A',
      'real problem B',
    ]);
  });

  it('preserves order of meaningful warnings', () => {
    const input = ['c', 'a', 'b'];
    expect(filterMeaningfulWarnings(input)).toEqual(['c', 'a', 'b']);
  });

  it('keeps duplicate meaningful entries (no de-dup applied)', () => {
    const input = ['real', 'real', "unsupported call 'LogOutput'", "unsupported call 'LogOutput'"];
    expect(filterMeaningfulWarnings(input)).toEqual(['real', 'real']);
  });

  it('accepts readonly arrays', () => {
    const input: ReadonlyArray<string> = ['real', 'RunProcess not executed by simulator'];
    expect(filterMeaningfulWarnings(input)).toEqual(['real']);
  });
});
