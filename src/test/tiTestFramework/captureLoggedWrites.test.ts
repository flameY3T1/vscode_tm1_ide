import { describe, it, expect } from 'vitest';
import { rewriteSource } from '../../tiTestFramework/rewriter/tiSourceRewriter';
import { parseLog, extractRuleReads, ruleLengthMatches } from '../../tiTestFramework/log/logParser';
import { instrumentReads } from '../../tiTestFramework/rewriter/instrumentReads';
import { buildOpRow } from '../../tiSimulator/output/opEmitter';
import { evalStatement, ProcessQuitSignal } from '../../tiSimulator/eval/evalStatement';
import { Scope } from '../../tiSimulator/eval/scope';
import { OutputCollector } from '../../tiSimulator/output/outputCollector';
import { parseStatements } from '../../tiSimulator/ast/parseStatement';
import { findBuiltin } from '../../tiSimulator/eval/builtins';
import { numToStr } from '../../tiSimulator/eval/builtins/_helpers';
import { emptyFixtures, type SimWarning } from '../../tiSimulator/types';

// Gap scan 2026-10-19 (370 live processes): object-level attribute writes ran
// live during capture, unlogged; the simulator only warned about them.
describe('object-level attribute writes', () => {
  it('capture logs them and then runs the original', () => {
    const res = rewriteSource(
      `CubeAttrPutN(1, 'Plan', 'Flag');\nDimensionAttrPutS('x', 'Konto', 'Note', 'de');`,
      'sLog',
    );
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'CubeAttrPutN', NumberToString(1), 'Plan', 'Flag')`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'DimensionAttrPutS', 'x', 'Konto', 'Note', 'de')`);
    expect(res.rewritten).toMatch(/^\s*CubeAttrPutN\(1, 'Plan', 'Flag'\)/m);
  });

  it('simulator emits the same row the capture log parses into', () => {
    const logged = parseLog('"CubeAttrPutN","1","Plan","Flag"\n').rows;
    expect(logged).toEqual([buildOpRow('CubeAttrPutN', [1, 'Plan', 'Flag'])]);
  });

  it('server-wide side effects stay in the clone and run live', () => {
    const src = `DeleteAllPersistentFeeders;\nSecurityRefresh;\nSaveDataAll();\nCubeSaveData('Plan');`;
    expect(rewriteSource(src, 'sLog').rewritten).toBe(src);
  });
});

// Capture stays a full live run for these; they only gain a log marker so the
// diff sees them (2026-10-19).
describe('live writes with a log marker', () => {
  it('Direct element writes run live and log the same row as the buffered call', () => {
    const res = rewriteSource(`DimensionElementInsertDirect('Konto', '', 'E1', 'N');`, 'sLog');
    expect(res.rewritten).toContain(`DimensionElementInsertDirect('Konto', '', 'E1', 'N')`);
    const marker = /ASCIIOutput\(sLog, '([^']+)'/.exec(res.rewritten)![1];
    expect(marker).toBe('DimElementInsert');
    expect(buildOpRow('DimensionElementInsertDirect', ['Konto', '', 'E1', 'N'])).toEqual(
      buildOpRow('DimensionElementInsert', ['Konto', '', 'E1', 'N']),
    );
  });

  it('structure and security writes keep running and get a marker', () => {
    const res = rewriteSource(`CubeClearData('Plan');\nPublishSubset('Konto', 'S', 1);`, 'sLog');
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'CubeClearData', 'Plan')`);
    expect(res.rewritten).toContain(`CubeClearData('Plan')`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'PublishSubset', 'Konto', 'S', NumberToString(1))`);
    expect(parseLog('"PublishSubset","Konto","S","1"\n').rows).toEqual([buildOpRow('PublishSubset', ['Konto', 'S', 1])]);
  });

  it('never writes a password or rule text into the log', () => {
    const res = rewriteSource(`AssignClientPassword('u', 'secret');\nCubeRuleSet('Plan', sRule);`, 'sLog');
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'AssignClientPassword', 'u');`);
    expect(res.rewritten).toContain(`ASCIIOutput(sLog, 'CubeRuleSet', 'Plan');`);
    expect(buildOpRow('AssignClientPassword', ['u', 'secret'])).toEqual({ op: 'AssignClientPassword', args: ['u'] });
  });
});

describe('process exit codes and ChoreQuit (measured on 11.8, 2026-10-19)', () => {
  it('ProcessExit* return the values of the captured server version', () => {
    expect(findBuiltin('ProcessExitByBreak')!.invoke([])).toBe(8);
    expect(findBuiltin('ProcessExitByChoreQuit')!.invoke([])).toBe(17);
    const v12 = { ...emptyFixtures(), v12: true };
    expect(findBuiltin('ProcessExitByBreak')!.invoke([], v12)).toBe(8);
    expect(findBuiltin('ProcessExitByChoreQuit')!.invoke([], v12)).toBe(18);
    expect(findBuiltin('ProcessExitSeriousError')!.invoke([], v12)).toBe(12);
  });

  it('ChoreQuit outside a chore stops the process like ProcessQuit', () => {
    const [stmt] = parseStatements('ChoreQuit;').statements;
    const warnings: SimWarning[] = [];
    expect(() =>
      evalStatement(stmt, { scope: new Scope(), output: new OutputCollector(), warnings, section: 'prolog' }),
    ).toThrow(ProcessQuitSignal);
  });
});

describe('v12 job functions and MIN/MAX (measured on v12, 2026-10-19)', () => {
  it('a job never runs in the simulator, so it reports finished', () => {
    expect(findBuiltin('ProcessExecutionInProgress')!.invoke([])).toBe(10);
    expect(findBuiltin('GetJobStatus')!.invoke(['job'])).toBe(0);
    expect(findBuiltin('WaitForInternalJobs')!.invoke([])).toBe(1);
    expect(findBuiltin('ReturnTableHandle')!.invoke([])).toBe(1);
  });

  it('HTTP calls are skipped with an error, not answered', () => {
    expect(() => findBuiltin('ExecuteHttpRequest')!.invoke(['GET', 'http://x'])).toThrow(/not simulated/);
  });

  it('MIN/MAX take two numbers', () => {
    expect(findBuiltin('MIN')!.invoke([3, -2])).toBe(-2);
    expect(findBuiltin('MAX')!.invoke([3, -2])).toBe(3);
  });
});

describe('CubeRuleGet capture (rule text cannot travel through the CSV log)', () => {
  it('logs cube and LONG of the text, not the text', () => {
    const out = instrumentReads(`sRule = CubeRuleGet(pCube);`, 'sLog');
    expect(out).toContain(`ASCIIOutput(sLog, '__RULEREAD__', pCube, NumberToString(LONG(CubeRuleGet(pCube))));`);
  });

  it('the marker is not a diff row, and extractRuleReads reads it back', () => {
    const log = '"__RULEREAD__","Plan","487"\n"__RULEREAD__","Leer","0"\n';
    expect(parseLog(log).rows).toEqual([]);
    expect(extractRuleReads(log)).toEqual([{ cube: 'Plan', length: 487 }, { cube: 'Leer', length: 0 }]);
  });

  it('the simulator reads the fetched text from attr-reads', () => {
    const fx = emptyFixtures();
    fx.objectAttributes!.set('cuberuleget\tPlan', 'SKIPCHECK;');
    expect(findBuiltin('CubeRuleGet')!.invoke(['Plan'], fx)).toBe('SKIPCHECK;');
    expect(findBuiltin('CubeRuleGet')!.invoke(['Other'], fx)).toBe('');
  });
});

describe('capture log records spanning lines (live run 2026-10-19)', () => {
  it('a quoted value with a line break stays one record', () => {
    // CellPutS of CubeRuleGet text: TM1 wrote the LF verbatim inside the quotes.
    const log = '"CellPutS","T","North","Info","54:SKIPCHECK;\n["\r\n"CellPutS","T","South","Info","x"\r\n';
    expect(parseLog(log).rows).toEqual([
      { op: 'CellPutS', cube: 'T', coord: ['North', 'Info'], value: '54:SKIPCHECK;\n[' },
      { op: 'CellPutS', cube: 'T', coord: ['South', 'Info'], value: 'x' },
    ]);
  });
  // Measured 2026-10-21 on 11.8 + v12: ASCIIOutput writes exactly this, the quote unescaped.
  it('a literal quote right before the break does not close the record', () => {
    const log = '"CellPutS","T","North","Info","hello "\nworld"\n"CellPutS","T","South","Info","ok"\n';
    expect(parseLog(log)).toMatchObject({
      rows: [
        { op: 'CellPutS', cube: 'T', coord: ['North', 'Info'], value: 'hello "\nworld' },
        { op: 'CellPutS', cube: 'T', coord: ['South', 'Info'], value: 'ok' },
      ],
      warnings: [],
    });
  });
});

// Review 2026-10-20.
describe('capture/simulator parity details', () => {
  it('numeric tuple args are formatted like NumberToString on both sides', () => {
    expect(buildOpRow('CubeAttrPutN', [0.1 + 0.2, 'Plan', 'Flag'])).toEqual(
      parseLog('"CubeAttrPutN","0,3","Plan","Flag"\n').rows[0],
    );
  });

  it('numToStr keeps every digit from 1e21 on', () => {
    expect(numToStr(1e21)).toBe('1000000000000000000000');
    expect(numToStr(-2e22)).toBe('-20000000000000000000000');
  });

  it('a rule read matches across line endings and code points', () => {
    expect(ruleLengthMatches('a\r\nb', 3)).toBe(true);
    expect(ruleLengthMatches('a\nb', 4)).toBe(true);
    expect(ruleLengthMatches('a😀', 2)).toBe(true);
    expect(ruleLengthMatches('abc', 5)).toBe(false);
  });

  it('warnings name the physical line after a multi-line value', () => {
    const log = '"__TEXTOUTPUT__","f","a\nb\nc"\n"Bogus","x"\n';
    expect(parseLog(log).warnings.map((w) => w.line)).toEqual([4]);
  });
});
