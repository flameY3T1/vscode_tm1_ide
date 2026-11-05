/**
 * `ascii-output-overwrite` — ASCIIOutput/TextOutput to a file that an earlier
 * procedure already wrote. Parsed with the real TI parser so argument tokens
 * match production.
 */
import { describe, expect, it } from 'vitest';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import type { LintOptions } from '../tiLogicVisualizer/tiLinter';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import type { TiAst } from '../tiLogicVisualizer/types';

const parse = (code: string): TiAst => {
  const r = parseTiCode(code);
  if (!r.ok) { throw new Error(r.error.message); }
  return r.ast;
};

const RULE = 'ascii-output-overwrite';

function hits(code: string, options?: LintOptions) {
  return lintTiAst(parse(code), undefined, undefined, undefined, 'data', options)
    .filter(d => d.ruleId === RULE);
}

describe('ascii-output-overwrite', () => {
  it('flags the same literal file written in the Prolog and again in the Data', () => {
    const prolog = parse("ASCIIOutput('out.csv', 'Header');");
    const r = hits("ASCIIOutput('OUT.csv', vA);", { previousAsts: [prolog] });
    expect(r).toHaveLength(1);
    expect(r[0].messageArgs).toEqual(["'OUT.csv'"]);
  });

  it('flags the same variable as file name, and TextOutput too', () => {
    const prolog = parse("sFile = 'out.csv';\nTextOutput(sFile, 'Header');");
    expect(hits("ASCIIOutput(sfile, vA);", { previousAsts: [prolog] })).toHaveLength(1);
  });

  it('reports once per file and procedure', () => {
    const prolog = parse("ASCIIOutput('out.csv', 'H');");
    expect(hits("ASCIIOutput('out.csv', vA);\nASCIIOutput('out.csv', vB);", { previousAsts: [prolog] })).toHaveLength(1);
  });

  it('is silent for a different file, or when only one procedure writes', () => {
    const prolog = parse("ASCIIOutput('a.csv', 'H');");
    expect(hits("ASCIIOutput('b.csv', vA);", { previousAsts: [prolog] })).toHaveLength(0);
    expect(hits("ASCIIOutput('a.csv', vA);\nASCIIOutput('a.csv', vB);")).toHaveLength(0);
  });

  it('is silent when the file is opened with AsciiOutputOpen anywhere in the process', () => {
    const prolog = parse("ASCIIOutput('out.csv', 'H');");
    const epilog = parse("AsciiOutputOpen('out.csv', 1);");
    expect(hits("ASCIIOutput('out.csv', vA);", { previousAsts: [prolog], futureAsts: [epilog] })).toHaveLength(0);
  });
});
