/**
 * The two drillthrough return statements.
 *
 * Architect generates them in the Epilog of a `}Drill_*` process, between
 * `#****Begin: Generated Statements***` and `#****End`. Both were missing from
 * `tiSignatures` — measured on three processes of the test instance, all with
 * `RETURNSQLTABLEHANDLE;`, and the parser reported "Unknown statement" on it.
 * An error on code that TM1 wrote itself.
 *
 * `ReturnSQLTableHandle` stands without parentheses (0 arguments, void) and therefore
 * falls into `BARE_KEYWORDS` by itself — the parser derives the set from the
 * signatures (0/0/void), there is no second list to maintain for it.
 */
import { describe, it, expect } from 'vitest';
import { parseTiCodeAccumulating, parseTiCode } from '../tiLogicVisualizer/tiParser';
import { BARE_KEYWORDS } from '../tiLogicVisualizer/tiParser/statements';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';

describe('ReturnSQLTableHandle', () => {
  it('is in the signatures as an argument-less void call', () => {
    const sig = KNOWN_SIGNATURES.get('returnsqltablehandle');
    expect(sig).toBeTruthy();
    expect(sig!.name).toBe('ReturnSQLTableHandle');
    expect(sig!.minParams).toBe(0);
    expect(sig!.maxParams).toBe(0);
    expect(sig!.returnType).toBe('void');
  });

  it('therefore falls into BARE_KEYWORDS by itself', () => {
    expect(BARE_KEYWORDS.has('returnsqltablehandle')).toBe(true);
  });

  it('is not a parse error without parentheses', () => {
    // Verbatim as in `}Drill_test5`, capitalization included.
    const src = [
      '#****Begin: Generated Statements***',
      'RETURNSQLTABLEHANDLE;',
      '#****End: Generated Statements****',
    ].join('\n');
    const r = parseTiCodeAccumulating(src);
    expect(r.errors).toEqual([]);
    expect(r.ast).toHaveLength(1);
    expect(r.ast[0].line).toBe(2);
    expect(parseTiCode(src).ok).toBe(true);
  });

  it('is not treated by the linter as an unknown function or undefined variable', () => {
    const src = 'RETURNSQLTABLEHANDLE;';
    const diags = lintTiAst(parseTiCodeAccumulating(src).ast, undefined, src, undefined, undefined, {});
    expect(diags.filter(d => d.ruleId === 'unknown-function')).toEqual([]);
    expect(diags.filter(d => d.ruleId === 'undefined-variable')).toEqual([]);
  });
});

describe('ReturnViewHandle', () => {
  it('is in the signatures with cube and view', () => {
    const sig = KNOWN_SIGNATURES.get('returnviewhandle');
    expect(sig).toBeTruthy();
    expect(sig!.name).toBe('ReturnViewHandle');
    expect(sig!.minParams).toBe(2);
    expect(sig!.maxParams).toBe(2);
    expect(sig!.params.map(p => p.type)).toEqual(['string', 'string']);
    expect(sig!.returnType).toBe('void');
  });

  it('is not treated by the linter as an unknown function', () => {
    // Verbatim as in `}Drill_test` and `}Drill_test2`.
    const src = "RETURNVIEWHANDLE('c1','Ansicht1');";
    const r = parseTiCodeAccumulating(src);
    expect(r.errors).toEqual([]);
    const diags = lintTiAst(r.ast, undefined, src, undefined, undefined, {});
    expect(diags.filter(d => d.ruleId === 'unknown-function')).toEqual([]);
    expect(diags.filter(d => d.ruleId === 'wrong-arg-count')).toEqual([]);
  });
});
