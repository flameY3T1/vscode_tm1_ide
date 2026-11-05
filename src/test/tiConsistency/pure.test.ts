import { describe, it, expect } from 'vitest';
import { resolveTarget } from '../../webviewClient/tiConsistency/pure';

// Regression coverage for the Critical whole-branch-review finding: applying
// Function/Keyword Casing rewrote e.g. `CellPutN` -> `cellputn` and `IF` ->
// `if` because the webview fell back to the lowercase GROUP KEY (`g.key`)
// instead of the canonical `targetSuggestion` whenever there was no editable
// <input> to read from. `resolveTarget` is the DOM-free extraction of that
// decision (see pure.ts for why — no jsdom/happy-dom in this repo's vitest
// config, so the real DOM rendering in index.ts is not directly testable).
describe('resolveTarget', () => {
  it('non-editable rule (function-casing) always returns targetSuggestion, never the key', () => {
    const g = { key: 'cellputn', editableTarget: false, targetSuggestion: 'CellPutN' };
    expect(resolveTarget(g)).toBe('CellPutN');
    // Even if some stray inputValue is passed (shouldn't happen — no input exists
    // for non-editable groups — but the function must ignore it defensively).
    expect(resolveTarget(g, 'cellputn')).toBe('CellPutN');
  });

  it('non-editable rule (keyword-casing) always returns targetSuggestion, never the key', () => {
    const g = { key: 'if', editableTarget: false, targetSuggestion: 'IF' };
    expect(resolveTarget(g)).toBe('IF');
  });

  it('editable rule (var-casing) uses the user-edited input value when present', () => {
    const g = { key: 'sdim', editableTarget: true, targetSuggestion: 'sDim' };
    expect(resolveTarget(g, 'sDimension')).toBe('sDimension');
  });

  it('editable rule falls back to targetSuggestion when input is empty/undefined, never the key', () => {
    const g = { key: 'sdim', editableTarget: true, targetSuggestion: 'sDim' };
    expect(resolveTarget(g, undefined)).toBe('sDim');
    expect(resolveTarget(g, '')).toBe('sDim');
    expect(resolveTarget(g, '   ')).toBe('sDim');
  });

  it('editable rule (naming-convention) uses edited input value', () => {
    const g = { key: 'legacyname', editableTarget: true, targetSuggestion: 'LegacyName' };
    expect(resolveTarget(g, 'ModernName')).toBe('ModernName');
  });
});
