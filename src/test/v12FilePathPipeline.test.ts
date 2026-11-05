import { describe, it, expect } from 'vitest';
import { parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';
import { lintTiAstWithContext } from '../tiLogicVisualizer/tiLinter';
import { applyLintRuleConfig } from '../tiLogicVisualizer/tiLinter/ruleConfig';

/**
 * The rule fired in isolation but not in the editor, because it sat in the diagnostics
 * provider while the process editor lints through lintTiAstWithContext. This test walks the
 * path the editor actually takes — parse, lint, rule-config gate — so a rule that is wired
 * into the wrong place fails here instead of in the user's hands.
 */
function lint(code: string, v12Mode: boolean) {
  const parsed = parseTiCodeAccumulating(code);
  const { diagnostics } = lintTiAstWithContext(
    parsed.ast, undefined, code, undefined, 'prolog', { v12Mode },
  );
  return applyLintRuleConfig(diagnostics, { rules: {} }, 'prolog');
}

describe('v12-file-path through the process editor lint path', () => {
  it('reports a traversal when V12 mode is on', () => {
    const hits = lint("AsciiOutput('../x.csv', 'a');", true).filter(d => d.ruleId === 'v12-file-path');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageArgs).toEqual(['AsciiOutput', '../x.csv']);
  });

  it('stays silent when V12 mode is off', () => {
    expect(lint("AsciiOutput('../x.csv', 'a');", false).filter(d => d.ruleId === 'v12-file-path')).toEqual([]);
  });

  it('replaces the portability warning on a drive letter in V12 mode', () => {
    // One squiggle, and it says the stronger thing: on v12 this call aborts, it is not
    // merely unportable.
    const ids = lint("AsciiOutput('C:\\temp\\x.csv', 'a');", true).map(d => d.ruleId);
    expect(ids).toContain('v12-file-path');
    expect(ids).not.toContain('hardcoded-path');
  });

  it('keeps the portability warning outside V12 mode', () => {
    const ids = lint("AsciiOutput('C:\\temp\\x.csv', 'a');", false).map(d => d.ruleId);
    expect(ids).toContain('hardcoded-path');
    expect(ids).not.toContain('v12-file-path');
  });

  it('leaves a hardcoded path in a non-file function alone', () => {
    // ExecuteCommand is not one of the seven restricted file functions.
    const ids = lint("ExecuteCommand('C:\\tools\\run.bat', 1);", true).map(d => d.ruleId);
    expect(ids).toContain('hardcoded-path');
    expect(ids).not.toContain('v12-file-path');
  });
});
