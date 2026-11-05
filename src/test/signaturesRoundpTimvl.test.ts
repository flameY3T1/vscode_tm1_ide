import { describe, it, expect } from 'vitest';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

// Signatures are loaded by src/test/setup.ts (global vitest setupFiles).

function diagsOf(code: string) {
  const r = parseTiCode(code);
  const ast = r.ok ? r.ast : [];
  return lintTiAst(ast, undefined, code, undefined, 'prolog');
}

describe('ROUNDP / TIMVL recognized', () => {
  it('KNOWN_SIGNATURES has roundp + timvl', () => {
    expect(KNOWN_SIGNATURES.get('roundp')?.name).toBe('ROUNDP');
    expect(KNOWN_SIGNATURES.get('timvl')?.name).toBe('TIMVL');
  });
  it('ROUNDP not flagged unknown-function', () => {
    const d = diagsOf('nX = ROUNDP(1.234, 2);');
    expect(d.some(x => x.ruleId === 'unknown-function')).toBe(false);
  });
  it('TIMVL not flagged unknown-function', () => {
    const d = diagsOf('nY = TIMVL(nTs, 1);');
    expect(d.some(x => x.ruleId === 'unknown-function')).toBe(false);
  });
  it('flags a numeric arg in a string variadic slot (TextOutput ValueN)', () => {
    // Regression: variadic args past the declared params were unchecked, so a
    // numeric (e.g. t = CODE(...)) passed to TextOutput slipped through.
    const num = diagsOf("nT = CODE('abc', 2);\nTextOutput('f', 'x', nT);");
    expect(num.some(x => x.ruleId === 'wrong-param-type')).toBe(true);
    const str = diagsOf("sT = 'y';\nTextOutput('f', 'x', sT);");
    expect(str.some(x => x.ruleId === 'wrong-param-type')).toBe(false);
  });

  it('ROUND is a 1-arg signature (TM1 live-verified — 2-arg aborts)', () => {
    // Was wrongly registered as 2-arg ROUND(Number, Decimals); TM1's ROUND takes
    // one arg (rounds to nearest integer) — ROUNDP is the decimal-places variant.
    expect(KNOWN_SIGNATURES.get('round')?.minParams).toBe(1);
    expect(KNOWN_SIGNATURES.get('round')?.maxParams).toBe(1);
    expect(KNOWN_SIGNATURES.get('round')?.params.length).toBe(1);
    expect(diagsOf('nX = ROUND(1.5);').some(x => x.ruleId === 'unknown-function')).toBe(false);
  });
});
