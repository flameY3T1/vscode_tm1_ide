import { describe, it, expect } from 'vitest';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import { parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';

function lint(src: string) {
  return lintTiAst(parseTiCodeAccumulating(src).ast);
}

describe('invalid-arg-value (generic enum)', () => {
  it('flags an invalid LogOutput severity literal', () => {
    const d = lint("LogOutput('INF', 'msg');").filter(x => x.ruleId === 'invalid-arg-value');
    expect(d).toHaveLength(1);
    expect(d[0].messageArgs).toEqual(['INF', 'LogOutput', 'DEBUG, INFO, WARN, ERROR, FATAL']);
  });
  it('accepts a valid severity case-insensitively', () => {
    const d = lint("LogOutput('info', 'msg');").filter(x => x.ruleId === 'invalid-arg-value');
    expect(d).toHaveLength(0);
  });
  it('skips non-literal arguments', () => {
    const d = lint("LogOutput(vLevel, 'msg');").filter(x => x.ruleId === 'invalid-arg-value');
    expect(d).toHaveLength(0);
  });
});
