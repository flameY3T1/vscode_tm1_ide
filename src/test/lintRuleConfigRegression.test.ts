import { describe, it, expect } from 'vitest';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import { applyLintRuleConfig } from '../tiLogicVisualizer/tiLinter/ruleConfig';

const CORPUS = [
  "x = 1;\nWHILE(x < 10);\nx = x + 1;\nEND;",
  "CellPutN(1, 'Cube', 'e1', 'e2');",
  "IF(1 = 1);\nProcessQuit;\nENDIF;",
  "sName = 'abc';\nnVal = 5;",
];

const NEW_RULE_IDS = new Set([
  'var-naming-prefix', 'param-naming-prefix', 'datasource-var-naming', 'missing-docstring',
  'invalid-object-name', 'comment-before-if', 'comment-before-while',
]);

function diagsOf(code: string) {
  const result = parseTiCode(code);
  const ast = result.ok ? result.ast : [];
  return lintTiAst(ast, undefined, code, undefined, 'prolog');
}

describe('default lint config preserves existing behavior', () => {
  it('default filter keeps existing+S diagnostics unchanged, drops only default-off N/D', () => {
    for (const code of CORPUS) {
      const raw = diagsOf(code);
      const filtered = applyLintRuleConfig(raw.map(d => ({ ...d })), { rules: {} });
      const expected = raw.filter(d => !NEW_RULE_IDS.has(d.ruleId as string));
      expect(filtered).toEqual(expected);
    }
  });
});
