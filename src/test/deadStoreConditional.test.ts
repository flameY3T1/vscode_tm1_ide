import { describe, it, expect } from 'vitest';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';

function diagsOf(code: string) {
  const r = parseTiCode(code);
  const ast = r.ok ? r.ast : [];
  return lintTiAst(ast, undefined, code, undefined, 'metadata');
}

describe('dead-store: conditional branches', () => {
  it('no dead-store when reassignments are in separate IF branches', () => {
    const d = diagsOf("nElType = 1;\nIF (vType @= 'C'); nElType = 2; ENDIF;\nIF (vType @= 'S'); nElType = 3; ENDIF;");
    expect(d.some(x => x.ruleId === 'dead-store')).toBe(false);
  });
  it('no dead-store for a conditional reassignment of a default', () => {
    const d = diagsOf("nFlag = 0;\nIF (vX @= 'Y'); nFlag = 1; ENDIF;");
    expect(d.some(x => x.ruleId === 'dead-store')).toBe(false);
  });
  it('still flags a genuine top-level dead-store', () => {
    const d = diagsOf("nX = 1;\nnX = 2;\nnX = 3;");
    expect(d.some(x => x.ruleId === 'dead-store')).toBe(true);
  });
});
