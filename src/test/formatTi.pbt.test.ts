import { describe, it, expect } from 'vitest';
import { formatTi } from '../tiLogicVisualizer/formatTi';
import { DEFAULT_FORMAT_CONFIG, type TiFormatConfig, type FRuleId } from '../tiLogicVisualizer/formatRules';

const SAMPLES = [
  'if(x);foo( 1,2 );endif;',
  "s = 'a;b , c'; # keep #literal",
  'while(i<>0);CellPutN(1,c,e);end;',
  '   x   =   1 ;   ',
  'ELSEIF(a>=b); bar; ELSE; baz;',
  "IF ( TRIM( vParent ) @<> '' ); x = 1; ENDIF;",
  "IF ( a @= 'C' ); y = a @<> 'S'; ENDIF;",
  "nRet = ExecuteProcess('Bedrock.Cube.Clear', 'pCube', sCube, 'pView', sView, 'pLogOutput', 1);",
  "IF(a=1);\nnRet = RunProcess('Some.Process', 'pX', 'a,b(c)', 'pYY', vLongVariableName, 'pZ', 3);\nENDIF;",
  "x = ExecuteProcess('P',\n    'pA', 1,\n    'pB', 2);",
];

function randomConfig(seed: number): TiFormatConfig {
  const ids: FRuleId[] = ['keyword-case','operator-spacing','space-after-comma','no-space-before-semicolon','collapse-spaces','no-trailing-space','space-after-comment','block-indent','one-statement-per-line','max-blank-lines','wrap-long-calls'];
  const enabled = { ...DEFAULT_FORMAT_CONFIG.enabled };
  ids.forEach((id, k) => { enabled[id] = ((seed >> k) & 1) === 1; });
  const paren = (['tight','spaced','off'] as const)[seed % 3];
  const wrapColumn = seed % 2 === 0 ? 60 : 120;
  return { ...DEFAULT_FORMAT_CONFIG, enabled, parenStyle: paren, wrapColumn };
}

describe('formatTi idempotency', () => {
  it('format(format(x)) === format(x) for default config', () => {
    for (const s of SAMPLES) {
      const once = formatTi(s);
      expect(formatTi(once)).toBe(once);
    }
  });
  it('idempotent across random config subsets', () => {
    for (let seed = 0; seed < 2048; seed++) { // 11 rule bits
      const cfg = randomConfig(seed);
      for (const s of SAMPLES) {
        const once = formatTi(s, cfg);
        expect(formatTi(once, cfg)).toBe(once);
      }
    }
  });
});
