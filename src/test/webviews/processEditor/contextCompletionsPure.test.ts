import { describe, it, expect } from 'vitest';
import {
  getEnclosingFunctionName,
  buildCubeInsertTextWithVars,
  buildProcessInsertText,
} from '../../../webviewClient/processEditorMonaco/contextCompletionsPure';

describe('getEnclosingFunctionName', () => {
  it('returns null for empty/plain input', () => {
    expect(getEnclosingFunctionName('')).toBeNull();
    expect(getEnclosingFunctionName('plain text')).toBeNull();
  });
  it('returns name for simple open call', () => {
    expect(getEnclosingFunctionName('CellGetN(')).toBe('CellGetN');
  });
  it('returns name with args present', () => {
    expect(getEnclosingFunctionName("CellGetN('Plan', ")).toBe('CellGetN');
  });
  it('returns null when balanced parens close before cursor', () => {
    expect(getEnclosingFunctionName('CellGetN(...) ')).toBeNull();
  });
  it('handles nested balanced parens', () => {
    expect(getEnclosingFunctionName('Outer(1, Inner(2, 3), ')).toBe('Outer');
  });
  it('handles inner unbalanced call (returns innermost open)', () => {
    expect(getEnclosingFunctionName('Outer(Inner(')).toBe('Inner');
  });
  it('skips whitespace between name and paren', () => {
    expect(getEnclosingFunctionName('CellGetN ( ')).toBe('CellGetN');
  });
  it('returns null when no word before paren', () => {
    expect(getEnclosingFunctionName('(')).toBeNull();
  });
});

describe('buildCubeInsertTextWithVars', () => {
  it('returns Name with quote for zero-dim cube', () => {
    expect(buildCubeInsertTextWithVars('Plan', [], new Map())).toEqual({
      insertText: "Plan'",
      isSnippet: false,
    });
  });
  it('emits placeholders for dims without matching v<Dim> variable', () => {
    const out = buildCubeInsertTextWithVars('Plan', ['Region', 'Period'], new Map());
    expect(out).toEqual({
      insertText: "Plan', '${1:Region}', '${2:Period}'",
      isSnippet: true,
    });
  });
  it('inserts variable name unquoted when v<Dim> variable exists (case-insensitive)', () => {
    const vars = new Map([['vregion', 'vRegion']]);
    const out = buildCubeInsertTextWithVars('Plan', ['Region', 'Period'], vars);
    expect(out.insertText).toBe("Plan', vRegion, '${1:Period}'");
    expect(out.isSnippet).toBe(true);
  });
  it('isSnippet false when ALL dims resolve via variables', () => {
    const vars = new Map([['vregion', 'vRegion'], ['vperiod', 'vPeriod']]);
    const out = buildCubeInsertTextWithVars('Plan', ['Region', 'Period'], vars);
    expect(out).toEqual({ insertText: "Plan', vRegion, vPeriod", isSnippet: false });
  });
  it('preserves original variable casing from map value', () => {
    const vars = new Map([['vregion', 'V_REGION']]);
    const out = buildCubeInsertTextWithVars('Plan', ['Region'], vars);
    expect(out.insertText).toBe("Plan', V_REGION");
  });
});

describe('buildProcessInsertText', () => {
  it('returns Name with quote for zero-param process', () => {
    expect(buildProcessInsertText('LoadActuals', [])).toEqual({
      insertText: "LoadActuals'",
      isSnippet: false,
    });
  });
  it('quotes string params, leaves numerics bare', () => {
    const out = buildProcessInsertText('Run', [
      { name: 'pYear', type: 'Numeric' },
      { name: 'pRegion', type: 'String' },
    ]);
    expect(out.insertText).toBe("Run', 'pYear', ${1:value}, 'pRegion', '${2:value}'");
    expect(out.isSnippet).toBe(true);
  });
  it('isSnippet true when any params present', () => {
    expect(buildProcessInsertText('R', [{ name: 'x', type: 'Numeric' }]).isSnippet).toBe(true);
  });
});
