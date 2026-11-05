import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeHelperTi,
  writeSimulatorTestSkeleton,
} from '../../../commands/tiTest/skeleton';
import type { ProcessFetchResult, WriteSkeletonInput } from '../../../commands/tiTest/types';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skel-writers-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

function makeSrc(overrides: Partial<ProcessFetchResult> = {}): ProcessFetchResult {
  return {
    prolog: '# safe prolog\n',
    metadata: '# safe metadata\n',
    data: '# safe data\n',
    epilog: '# safe epilog\n',
    parameters: [],
    datasource: { Type: 'None' },
    variables: [],
    ...overrides,
  };
}

async function readUtf8(p: string): Promise<string> {
  return await fs.readFile(p, 'utf8');
}

describe('writeHelperTi', () => {
  it('writes its logs into the ProcessError dir on v11 and under a bare name on v12', async () => {
    const src = makeSrc({ variables: [{ Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }] });
    const v11 = (await writeHelperTi(tmp, 'P', src, [])).helperSections;
    const v12 = (await writeHelperTi(tmp, 'P', src, [], true)).helperSections;
    const all = (s: typeof v11) => Object.values(s).join('\n');
    expect(all(v11)).toContain("GetProcessErrorFileDirectory() | 'TM1ProcessError_P_output.log'");
    expect(all(v11)).toContain("GetProcessErrorFileDirectory() | 'TM1ProcessError_P_source.log'");
    expect(all(v12)).not.toContain('GetProcessErrorFileDirectory');
    expect(all(v12)).toContain("'TM1ProcessError_P_output.log'");
    expect(all(v12)).toContain("TextOutput('TM1ProcessError_P_source.log'");
  });

  it('writes <fileBase>.ti + <fileBase>.params.txt under helperDir', async () => {
    const r = await writeHelperTi(tmp, 'MyProc', makeSrc(), [
      { Name: 'p1', Value: 7 },
      { Name: 'p2', Value: 'hi' },
    ]);
    const ti = await readUtf8(path.join(tmp, 'MyProc.ti'));
    expect(ti).toContain('#region prolog');
    expect(ti).toContain('#region metadata');
    expect(ti).toContain('#region data');
    expect(ti).toContain('#region epilog');
    expect(ti).toContain('TI-Test-Framework TI for MyProc');

    const params = await readUtf8(path.join(tmp, 'MyProc.params.txt'));
    expect(params).toBe('p1 = 7\np2 = hi\n');

    expect(r.helperName).toBe('MyProc_TI');
    expect(r.helperSections.prolog).toContain('safe prolog');
  });

  it('instruments cell reads in the data section with __CELLREAD__ markers', async () => {
    const r = await writeHelperTi(
      tmp,
      'ReadProc',
      makeSrc({ data: "sAttr = CELLGETS(sCube, sElem, 'Caption');\n" }),
      [],
    );
    void r;
    const ti = await readUtf8(path.join(tmp, 'ReadProc.ti'));
    expect(ti).toContain("'__CELLREAD__'");
    expect(ti).toContain("CELLGETS(sCube, sElem, 'Caption')");
    // the marker precedes the original read statement
    expect(ti.indexOf('__CELLREAD__')).toBeLessThan(ti.indexOf('sAttr = CELLGETS'));
  });

  it('sanitizes non-identifier chars in processName for fileBase', async () => {
    await writeHelperTi(tmp, 'Load Sales-2024!', makeSrc(), []);
    const ti = await readUtf8(path.join(tmp, 'Load_Sales_2024_.ti'));
    expect(ti).toContain('### TI-Test-Framework TI for Load Sales-2024! ###');
  });

  it('truncates fileBase to 56 chars and helperName to 60', async () => {
    const long = 'A'.repeat(80);
    const r = await writeHelperTi(tmp, long, makeSrc(), []);
    const fileBase = 'A'.repeat(56);
    expect(r.helperName.length).toBeLessThanOrEqual(60);
    expect(r.helperName).toBe(`${fileBase}_TI`);
    await readUtf8(path.join(tmp, `${fileBase}.ti`));
  });

  it('emits source-dump TextOutput when src.variables is non-empty', async () => {
    const r = await writeHelperTi(
      tmp,
      'P',
      makeSrc({
        variables: [
          { Name: 'vDim_1', Type: 'String', Position: 1, StartByte: 0, EndByte: 1 },
          { Name: 'vQty', Type: 'Numeric', Position: 2, StartByte: 2, EndByte: 3 },
        ],
      }),
      [],
    );
    expect(r.helperSections.data).toContain('TextOutput(');
    expect(r.helperSections.data).toContain('NumberToString(vQty)');
    expect(r.helperSections.data).toContain('vDim_1');
    expect(r.helperSections.data).toContain('TM1ProcessError_P_source.log');
  });

  it('emits placeholder comment when no source variables present', async () => {
    const r = await writeHelperTi(tmp, 'P', makeSrc(), []);
    expect(r.helperSections.data).toContain('no source variables detected');
  });

  it('logs mutation calls and keeps them so they run live', async () => {
    const src = makeSrc({ data: `CellPutN(42, 'C', 'e1', 'e2');` });
    const r = await writeHelperTi(tmp, 'P', src, []);
    expect(r.helperSections.data).toContain(`'CellPutN', 'C', 'e1', 'e2'`);
    expect(r.helperSections.data).toMatch(/^CellPutN\(42, 'C', 'e1', 'e2'\)/m);
  });
});

describe('writeSimulatorTestSkeleton', () => {
  function makeInput(overrides: Partial<WriteSkeletonInput> = {}): WriteSkeletonInput {
    return {
      testFolder: path.join(tmp, 'tA'),
      testName: 'tA',
      processName: 'Proc1',
      processSrc: makeSrc(),
      params: [{ Name: 'p1', Value: 5 }],
      serverName: 'srv1',
      extensionVersion: '1.25.0',
      ...overrides,
    };
  }

  it('creates data/, TI/, process.ti with all four #regions', async () => {
    await writeSimulatorTestSkeleton(makeInput());
    const ti = await readUtf8(path.join(tmp, 'tA', 'data', 'process.ti'));
    expect(ti).toContain('#region prolog');
    expect(ti).toContain('#region metadata');
    expect(ti).toContain('#region data');
    expect(ti).toContain('#region epilog');
    await fs.access(path.join(tmp, 'tA', 'TI', 'Proc1.ti'));
  });

  it('writes parameters.json + variables.json with declared shape', async () => {
    await writeSimulatorTestSkeleton(
      makeInput({
        params: [{ Name: 'p1', Value: 5 }],
        processSrc: makeSrc({
          variables: [
            { Name: 'vQty', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 1 },
          ],
        }),
      }),
    );
    const pj = JSON.parse(await readUtf8(path.join(tmp, 'tA', 'data', 'parameters.json')));
    expect(pj).toEqual([{ Name: 'p1', Value: 5 }]);
    const vj = JSON.parse(await readUtf8(path.join(tmp, 'tA', 'data', 'variables.json')));
    expect(vj).toEqual([{ Name: 'vQty', Type: 'Numeric' }]);
  });

  it('writes empty cube-dims.json + dim-fixtures.json when no cfg supplied', async () => {
    await writeSimulatorTestSkeleton(makeInput());
    const cd = JSON.parse(await readUtf8(path.join(tmp, 'tA', 'data', 'cube-dims.json')));
    const df = JSON.parse(await readUtf8(path.join(tmp, 'tA', 'data', 'dim-fixtures.json')));
    expect(cd).toEqual({});
    expect(df).toEqual({});
  });

  it('seeds cube-fixtures.jsonl + dim-attributes.json stubs', async () => {
    await writeSimulatorTestSkeleton(makeInput());
    const jsonl = await readUtf8(path.join(tmp, 'tA', 'data', 'cube-fixtures.jsonl'));
    expect(jsonl).toContain('CellGetN/CellGetS fixtures');
    const attr = await readUtf8(path.join(tmp, 'tA', 'data', 'dim-attributes.json'));
    expect(attr.trim()).toBe('{}');
  });

  it('writes README.md with process + test name', async () => {
    await writeSimulatorTestSkeleton(makeInput({ processName: 'PX', testName: 'TX' }));
    const md = await readUtf8(path.join(tmp, 'tA', 'README.md'));
    expect(md).toContain('# TI Test: TX');
    expect(md).toContain('Process: `PX`');
  });

  it('writes manifest with datasourceType=View when datasource type contains "view"', async () => {
    await writeSimulatorTestSkeleton(
      makeInput({ processSrc: makeSrc({ datasource: { Type: 'TM1CubeView' } }) }),
    );
    const m = JSON.parse(await readUtf8(path.join(tmp, 'tA', 'manifest.json')));
    expect(m.datasourceType).toBe('View');
    expect(m.name).toBe('tA');
    expect(m.process).toBe('Proc1');
    expect(m.active).toBe(true);
    expect(m.captured.server).toBe('srv1');
    expect(m.captured.extensionVersion).toBe('1.25.0');
  });

  it('derives datasourceType=Subset / File / None correctly', async () => {
    for (const [type, expected] of [
      ['SubsetSource', 'Subset'],
      ['ASCII', 'File'],
      ['FileSource', 'File'],
      ['Something', 'None'],
    ] as const) {
      const folder = path.join(tmp, `t-${type}`);
      await writeSimulatorTestSkeleton(
        makeInput({
          testFolder: folder,
          testName: `t-${type}`,
          processSrc: makeSrc({ datasource: { Type: type } }),
        }),
      );
      const m = JSON.parse(await readUtf8(path.join(folder, 'manifest.json')));
      expect(m.datasourceType).toBe(expected);
    }
  });

  it('seeds source.csv + output.csv stubs only when absent (preserves existing)', async () => {
    const folder = path.join(tmp, 'tPreserve');
    await fs.mkdir(path.join(folder, 'data'), { recursive: true });
    await fs.writeFile(path.join(folder, 'data', 'source.csv'), 'pre-existing-source\n', 'utf8');
    await fs.writeFile(path.join(folder, 'data', 'output.csv'), 'pre-existing-output\n', 'utf8');
    await writeSimulatorTestSkeleton(makeInput({ testFolder: folder, testName: 'tPreserve' }));
    expect(await readUtf8(path.join(folder, 'data', 'source.csv'))).toBe('pre-existing-source\n');
    expect(await readUtf8(path.join(folder, 'data', 'output.csv'))).toBe('pre-existing-output\n');
  });

  it('returns HelperRunResult from inner writeHelperTi', async () => {
    const r = await writeSimulatorTestSkeleton(makeInput({ processName: 'MyProc' }));
    expect(r.helperName).toBe('MyProc_TI');
    expect(r.helperSections.prolog).toContain('safe prolog');
  });
});
