/**
 * Error tolerance at BLOCK LEVEL.
 *
 * Until 2026-09-01 `parseTiCodeAccumulating` restarted after an error on a
 * SLICE of the source text. If the error sat inside a block, the preceding
 * part up to that point was not parseable on its own (an IF without ENDIF), and the
 * whole preceding part was thrown away — including statements BEFORE the block. Measured on
 *
 *     nA = 1;  IF(nA=1);  nB = 2;  nKaputt = ;  nC = 3;  ENDIF;  nD = 4;
 *
 * exactly `nC@5` and `nD@7` were left over: `nA`, `nB` and the block itself gone,
 * plus an INVENTED second error "Unexpected ENDIF without a matching IF"
 * on the error-free line 6.
 *
 * That hit every rule that relies on nesting — `endless-loop`,
 * `performance-hint`, `cellget-in-loop-constant`, `dead-code-condition`,
 * `empty-if`/`-while`, `unused-variable`/`dead-store`: after the first parse
 * error of a section they silently judged wrong, in both directions.
 */
import { describe, it, expect } from 'vitest';
import { parseTiCodeAccumulating, parseTiCode } from '../tiLogicVisualizer/tiParser';
import type { TiStatement } from '../tiLogicVisualizer/types';

/** Short form of a subtree: kind, line and nesting — nothing more is needed here. */
function sketch(s: TiStatement): unknown {
  if (s.type === 'if') {
    return {
      if: s.line,
      then: s.thenBody.map(sketch),
      elseIf: s.elseIfClauses.map(c => ({ line: c.line, body: c.body.map(sketch) })),
      else: s.elseBody.map(sketch),
    };
  }
  if (s.type === 'while') { return { while: s.line, body: s.body.map(sketch) }; }
  return `${s.type}@${s.line}`;
}

const code = (...lines: string[]) => lines.join('\n');

describe('parse error INSIDE an IF block', () => {
  const src = code(
    'nA = 1;',
    'IF( nA = 1 );',
    '  nB = 2;',
    '  nKaputt = ;',
    '  nC = 3;',
    'ENDIF;',
    'nD = 4;',
  );

  it('keeps everything except the broken line, with correct nesting', () => {
    const r = parseTiCodeAccumulating(src);
    expect(r.ast.map(sketch)).toEqual([
      'assignment@1',
      { if: 2, then: ['assignment@3', 'assignment@5'], elseIf: [], else: [] },
      'assignment@7',
    ]);
  });

  it('reports exactly one error, on the broken line', () => {
    const r = parseTiCodeAccumulating(src);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
    expect(r.errors[0].message).toMatch(/Empty assignment/);
  });

  it('does not invent an error on the ENDIF', () => {
    const r = parseTiCodeAccumulating(src);
    expect(r.errors.map(e => e.message).join(' ')).not.toMatch(/Unexpected ENDIF/);
  });
});

describe('parse error INSIDE a WHILE block', () => {
  it('keeps the loop body together', () => {
    const r = parseTiCodeAccumulating(code(
      'nI = 1;',
      'WHILE( nI <= 10 );',
      '  nSumme = nSumme + 1;',
      '  dies ist kein TI',
      '  nI = nI + 1;',
      'END;',
      'nFertig = 1;',
    ));
    expect(r.ast.map(sketch)).toEqual([
      'assignment@1',
      { while: 2, body: ['assignment@3', 'assignment@5'] },
      'assignment@7',
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
  });
});

describe('nested blocks', () => {
  it('keeps an IF inside a WHILE together', () => {
    const r = parseTiCodeAccumulating(code(
      'WHILE( nI <= 10 );',
      '  IF( nI = 5 );',
      '    nKaputt = ;',
      '    nTreffer = 1;',
      '  ENDIF;',
      '  nI = nI + 1;',
      'END;',
    ));
    expect(r.ast.map(sketch)).toEqual([
      {
        while: 1,
        body: [
          { if: 2, then: ['assignment@4'], elseIf: [], else: [] },
          'assignment@6',
        ],
      },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(3);
  });

  it('keeps ELSEIF and ELSE together, even with an error in one branch', () => {
    const r = parseTiCodeAccumulating(code(
      'IF( nA = 1 );',
      '  nX = 1;',
      'ELSEIF( nA = 2 );',
      '  kaputt kaputt',
      '  nY = 2;',
      'ELSE;',
      '  nZ = 3;',
      'ENDIF;',
    ));
    expect(r.ast.map(sketch)).toEqual([{
      if: 1,
      then: ['assignment@2'],
      elseIf: [{ line: 3, body: ['assignment@5'] }],
      else: ['assignment@7'],
    }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
  });
});

describe('several errors', () => {
  it('reports each one individually and rescues the rest', () => {
    const r = parseTiCodeAccumulating(code(
      'nA = ;',
      'nB = 2;',
      'kaputt kaputt',
      'nC = 3;',
    ));
    expect(r.ast.map(sketch)).toEqual(['assignment@2', 'assignment@4']);
    expect(r.errors.map(e => e.line)).toEqual([1, 3]);
  });
});

describe('unterminated blocks', () => {
  it('keeps the body of an IF without ENDIF and reports it once', () => {
    const r = parseTiCodeAccumulating(code(
      'IF( nA = 1 );',
      '  nB = 2;',
      '  nC = 3;',
    ));
    expect(r.ast.map(sketch)).toEqual([
      { if: 1, then: ['assignment@2', 'assignment@3'], elseIf: [], else: [] },
    ]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/Missing ENDIF/);
  });

  it('keeps the body of a WHILE without END', () => {
    const r = parseTiCodeAccumulating(code(
      'WHILE( nI <= 3 );',
      '  nI = nI + 1;',
    ));
    expect(r.ast.map(sketch)).toEqual([{ while: 1, body: ['assignment@2'] }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/Missing END/);
  });

  it('reports an ENDIF without IF and carries on afterwards', () => {
    const r = parseTiCodeAccumulating(code(
      'nA = 1;',
      'ENDIF;',
      'nB = 2;',
    ));
    expect(r.ast.map(sketch)).toEqual(['assignment@1', 'assignment@3']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    expect(r.errors[0].message).toMatch(/Unexpected ENDIF/);
  });
});

describe('error-free code stays unchanged', () => {
  it('returns the same tree as the strict parser', () => {
    const src = code(
      'nA = 1;',
      'IF( nA = 1 );',
      '  WHILE( nI < 3 );',
      '    nI = nI + 1;',
      '  END;',
      'ELSE;',
      '  nB = 2;',
      'ENDIF;',
    );
    const streng = parseTiCode(src);
    const tolerant = parseTiCodeAccumulating(src);
    expect(streng.ok).toBe(true);
    expect(tolerant.errors).toEqual([]);
    expect(tolerant.ast.map(sketch)).toEqual(
      (streng as { ok: true; ast: TiStatement[] }).ast.map(sketch),
    );
  });
});

describe('the strict parser stays strict', () => {
  it('still aborts at the first error', () => {
    const r = parseTiCode(code('nA = 1;', 'nKaputt = ;', 'nB = 2;'));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error.line).toBe(2);
  });
});
