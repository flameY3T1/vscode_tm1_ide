import { describe, it, expect } from 'vitest';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import { parseTiCodeAccumulating } from '../tiLogicVisualizer/tiParser';

const unknown = (src: string): string[] =>
  lintTiAst(parseTiCodeAccumulating(src).ast)
    .filter(d => d.ruleId === 'unknown-function')
    .map(d => String(d.messageArgs?.[0]));

describe('unknown-function inside expressions', () => {
  it('flags an unknown call on the right-hand side of an assignment', () => {
    expect(unknown("nX = CubeGetN('c', 'a');")).toEqual(['CubeGetN']);
  });

  it('flags an unknown call in IF, ELSEIF and WHILE conditions', () => {
    expect(unknown(`
IF(CellExists('c', 'a') = 1);
ELSEIF(ViewZero('c', 'v') = 0);
ENDIF;
WHILE(TokenNum(s) > 0);
END;
`)).toEqual(['CellExists', 'ViewZero', 'TokenNum']);
  });

  it('flags an unknown call nested in an argument', () => {
    expect(unknown("ASCIIOutput('f.txt', AttributeGet('d', 'e', 'a'));")).toEqual(['AttributeGet']);
  });

  it('stays silent for known functions, nested calls and text in string literals', () => {
    expect(unknown(`
nX = CellGetN('c', DimNm('d', 1)) + ABS(-1);
IF(SUBST(s, 1, 2) @= 'CubeGetN(x)' & DIMIX('d', 'e') > 0);
ENDIF;
ASCIIOutput('f.txt', NumberToString(nX));
`)).toEqual([]);
  });
});
