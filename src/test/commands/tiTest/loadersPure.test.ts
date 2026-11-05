import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveDataFile,
  resolveDataDir,
  loadCubeDims,
  loadVariableNames,
  loadParameters,
  splitWithMarkersOrAll,
  loadFixtures,
  loadProcessSections,
  pickSourceFile,
  loadSubModules,
  overlayCallParams,
} from '../../../commands/tiTest/loaders';
import { cubeCellKey, attrKey } from '../../../tiSimulator/types';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'loaders-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

async function write(rel: string, body: string): Promise<void> {
  const full = path.join(tmp, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body, 'utf8');
}

describe('resolveDataFile', () => {
  it('prefers data/<file> over legacy folder', async () => {
    await write('data/x.json', '{}');
    await write('input/x.json', '{}');
    const p = await resolveDataFile(tmp, 'x.json', 'input');
    expect(p).toBe(path.join(tmp, 'data', 'x.json'));
  });

  it('falls back to legacy input/<file>', async () => {
    await write('input/x.json', '{}');
    const p = await resolveDataFile(tmp, 'x.json', 'input');
    expect(p).toBe(path.join(tmp, 'input', 'x.json'));
  });

  it('falls back to legacy expected/<file>', async () => {
    await write('expected/y.json', '{}');
    const p = await resolveDataFile(tmp, 'y.json', 'expected');
    expect(p).toBe(path.join(tmp, 'expected', 'y.json'));
  });

  it('returns undefined when file nowhere', async () => {
    const p = await resolveDataFile(tmp, 'missing.json', 'input');
    expect(p).toBeUndefined();
  });
});

describe('resolveDataDir', () => {
  it('returns data/ when it exists', async () => {
    await fs.mkdir(path.join(tmp, 'data'));
    const d = await resolveDataDir(tmp, 'input');
    expect(d).toBe(path.join(tmp, 'data'));
  });

  it('returns legacy input/ when data/ missing', async () => {
    const d = await resolveDataDir(tmp, 'input');
    expect(d).toBe(path.join(tmp, 'input'));
  });

  it('returns legacy expected/ for expected param when data/ missing', async () => {
    const d = await resolveDataDir(tmp, 'expected');
    expect(d).toBe(path.join(tmp, 'expected'));
  });
});

describe('loadCubeDims', () => {
  it('returns empty object when file missing', async () => {
    expect(await loadCubeDims(tmp)).toEqual({});
  });

  it('parses cube-dims.json from data/', async () => {
    await write('data/cube-dims.json', JSON.stringify({ Plan: ['Region', 'Period'] }));
    expect(await loadCubeDims(tmp)).toEqual({ Plan: ['Region', 'Period'] });
  });

  it('falls back to legacy input/cube-dims.json', async () => {
    await write('input/cube-dims.json', JSON.stringify({ Sales: ['Month'] }));
    expect(await loadCubeDims(tmp)).toEqual({ Sales: ['Month'] });
  });

  it('drops entries with non-string array members', async () => {
    await write('data/cube-dims.json', JSON.stringify({
      Good: ['A', 'B'],
      Bad: ['A', 1, 'B'],
    }));
    const out = await loadCubeDims(tmp);
    expect(out.Good).toEqual(['A', 'B']);
    expect(out.Bad).toBeUndefined();
  });

  it('drops entries that are not arrays', async () => {
    await write('data/cube-dims.json', JSON.stringify({ Good: ['A'], Wrong: 42 }));
    const out = await loadCubeDims(tmp);
    expect(out.Good).toEqual(['A']);
    expect(out.Wrong).toBeUndefined();
  });

  it('returns empty for malformed JSON', async () => {
    await write('data/cube-dims.json', '{not json');
    expect(await loadCubeDims(tmp)).toEqual({});
  });
});

describe('loadVariableNames', () => {
  it('returns undefined when file missing', async () => {
    expect(await loadVariableNames(tmp)).toBeUndefined();
  });

  it('returns variable names from array of {Name}', async () => {
    await write('data/variables.json', JSON.stringify([
      { Name: 'vA' }, { Name: 'vB' }, { Name: 'vC' },
    ]));
    expect(await loadVariableNames(tmp)).toEqual(['vA', 'vB', 'vC']);
  });

  it('falls back to legacy input/variables.json', async () => {
    await write('input/variables.json', JSON.stringify([{ Name: 'vLegacy' }]));
    expect(await loadVariableNames(tmp)).toEqual(['vLegacy']);
  });

  it('returns undefined when JSON not an array', async () => {
    await write('data/variables.json', JSON.stringify({ Name: 'vWrong' }));
    expect(await loadVariableNames(tmp)).toBeUndefined();
  });

  it('returns undefined when JSON malformed', async () => {
    await write('data/variables.json', '[broken');
    expect(await loadVariableNames(tmp)).toBeUndefined();
  });
});

describe('loadParameters', () => {
  it('returns empty object when file missing', async () => {
    expect(await loadParameters(tmp)).toEqual({});
  });

  it('parses Name/Value pairs into record', async () => {
    await write('data/parameters.json', JSON.stringify([
      { Name: 'pNum', Value: 42 },
      { Name: 'pStr', Value: 'hello' },
    ]));
    expect(await loadParameters(tmp)).toEqual({ pNum: 42, pStr: 'hello' });
  });

  it('falls back to legacy input/parameters.json', async () => {
    await write('input/parameters.json', JSON.stringify([{ Name: 'pX', Value: 1 }]));
    expect(await loadParameters(tmp)).toEqual({ pX: 1 });
  });

  it('skips entries with non-string Name', async () => {
    await write('data/parameters.json', JSON.stringify([
      { Name: 'pOk', Value: 1 },
      { Value: 2 },
      { Name: 3, Value: 4 },
    ]));
    expect(await loadParameters(tmp)).toEqual({ pOk: 1 });
  });

  it('returns empty when JSON malformed', async () => {
    await write('data/parameters.json', '{bad');
    expect(await loadParameters(tmp)).toEqual({});
  });
});

describe('splitWithMarkersOrAll', () => {
  it('returns text in data section when no #region markers present', () => {
    const s = splitWithMarkersOrAll('i := 1;\nj := 2;');
    expect(s.prolog).toBe('');
    expect(s.metadata).toBe('');
    expect(s.data).toBe('i := 1;\nj := 2;');
    expect(s.epilog).toBe('');
  });

  it('extracts content between #region prolog and #endregion prolog', () => {
    const txt = '#region prolog\nP1;\nP2;\n#endregion prolog\n';
    expect(splitWithMarkersOrAll(txt).prolog).toBe('P1;\nP2;');
  });

  it('splits all four sections when all markers present', () => {
    const txt = [
      '#region prolog', 'P;', '#endregion prolog',
      '#region metadata', 'M;', '#endregion metadata',
      '#region data', 'D;', '#endregion data',
      '#region epilog', 'E;', '#endregion epilog',
    ].join('\n');
    const s = splitWithMarkersOrAll(txt);
    expect(s.prolog).toBe('P;');
    expect(s.metadata).toBe('M;');
    expect(s.data).toBe('D;');
    expect(s.epilog).toBe('E;');
  });

  it('ignores text outside any #region (between sections)', () => {
    const txt = [
      'comment-line-noise',
      '#region prolog', 'P;', '#endregion prolog',
      'another-noise',
      '#region data', 'D;', '#endregion data',
    ].join('\n');
    const s = splitWithMarkersOrAll(txt);
    expect(s.prolog).toBe('P;');
    expect(s.data).toBe('D;');
    expect(s.metadata).toBe('');
    expect(s.epilog).toBe('');
  });

  it('treats unknown #region kind as no-region (data fallback)', () => {
    const txt = '#region xxx\nfoo\n#endregion xxx\n';
    const s = splitWithMarkersOrAll(txt);
    expect(s.data).toBe(txt);
  });
});

describe('loadFixtures', () => {
  it('returns empty fixtures when no files present', async () => {
    const fx = await loadFixtures(tmp);
    expect(fx.dimensions.size).toBe(0);
    expect(fx.cubeCells.size).toBe(0);
    expect(fx.cubeDims.size).toBe(0);
    expect(fx.attributes.size).toBe(0);
  });

  it('loads dim-fixtures.json with elements + children', async () => {
    const body = JSON.stringify({
      DimA: {
        elements: [
          { name: 'Root', level: 1, children: ['A', 'B'] },
          { name: 'A', level: 0 },
          { name: 'B', level: 0 },
        ],
      },
    });
    await write('data/dim-fixtures.json', body);
    const fx = await loadFixtures(tmp);
    const elems = fx.dimensions.get('DimA');
    expect(elems).toHaveLength(3);
    expect(elems?.[0]).toEqual({ name: 'Root', level: 1, children: ['A', 'B'] });
    expect(elems?.[1]).toEqual({ name: 'A', level: 0 });
    expect(elems?.[1].children).toBeUndefined();
  });

  it('coerces non-numeric level to 0 and stringifies children', async () => {
    const body = JSON.stringify({
      D: { elements: [{ name: 'X', level: 'bogus', children: [1, 2] }] },
    });
    await write('data/dim-fixtures.json', body);
    const fx = await loadFixtures(tmp);
    expect(fx.dimensions.get('D')?.[0]).toEqual({
      name: 'X',
      level: 0,
      children: ['1', '2'],
    });
  });

  it('silently ignores malformed dim-fixtures JSON', async () => {
    await write('data/dim-fixtures.json', '{not json');
    const fx = await loadFixtures(tmp);
    expect(fx.dimensions.size).toBe(0);
  });

  it('loads cube-fixtures.jsonl skipping blank and # lines', async () => {
    const body = [
      '# comment',
      '',
      JSON.stringify({ cube: 'C', coord: ['E1', 'M1'], value: 42 }),
      JSON.stringify({ cube: 'C', coord: ['E2', 'M1'], value: 'hello' }),
    ].join('\n');
    await write('data/cube-fixtures.jsonl', body);
    const fx = await loadFixtures(tmp);
    expect(fx.cubeCells.get(cubeCellKey('C', ['E1', 'M1']))).toBe(42);
    expect(fx.cubeCells.get(cubeCellKey('C', ['E2', 'M1']))).toBe('hello');
  });

  it('loads cube-dims.json', async () => {
    await write('data/cube-dims.json', JSON.stringify({ Sales: ['Year', 'Region'] }));
    const fx = await loadFixtures(tmp);
    expect(fx.cubeDims.get('Sales')).toEqual(['Year', 'Region']);
  });

  it('loads dim-attributes.json with lowercased keys', async () => {
    const body = JSON.stringify({
      DimA: { ElemX: { AttrY: 'v', NumAttr: 7 } },
    });
    await write('data/dim-attributes.json', body);
    const fx = await loadFixtures(tmp);
    expect(fx.attributes.get(attrKey('DimA', 'ElemX', 'AttrY'))).toBe('v');
    expect(fx.attributes.get(attrKey('DimA', 'ElemX', 'NumAttr'))).toBe(7);
  });

  it('skips non-number/non-string attribute values', async () => {
    const body = JSON.stringify({
      D: { E: { Bad: { nested: 1 }, Good: 'ok' } },
    });
    await write('data/dim-attributes.json', body);
    const fx = await loadFixtures(tmp);
    expect(fx.attributes.get(attrKey('D', 'E', 'Bad'))).toBeUndefined();
    expect(fx.attributes.get(attrKey('D', 'E', 'Good'))).toBe('ok');
  });
});

describe('loadProcessSections', () => {
  it('returns undefined when neither process.ti nor split files exist', async () => {
    const r = await loadProcessSections(tmp);
    expect(r).toBeUndefined();
  });

  it('parses single data/process.ti via splitWithMarkersOrAll', async () => {
    const txt = '#region prolog\nP1\n#endregion prolog\n#region data\nD1\n#endregion data\n';
    await write('data/process.ti', txt);
    const r = await loadProcessSections(tmp);
    expect(r?.prolog).toBe('P1');
    expect(r?.data).toBe('D1');
    expect(r?.metadata).toBe('');
    expect(r?.epilog).toBe('');
  });

  it('falls back to legacy input/ directory split files', async () => {
    await write('input/prolog.ti', 'pro-body');
    await write('input/data.ti', 'data-body');
    const r = await loadProcessSections(tmp);
    expect(r?.prolog).toBe('pro-body');
    expect(r?.data).toBe('data-body');
    expect(r?.metadata).toBe('');
    expect(r?.epilog).toBe('');
  });

  it('returns undefined when only empty data/ dir is present', async () => {
    await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
    const r = await loadProcessSections(tmp);
    expect(r).toBeUndefined();
  });
});

describe('pickSourceFile', () => {
  it('returns undefined when data dir is empty', async () => {
    await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
    const r = await pickSourceFile(tmp);
    expect(r).toBeUndefined();
  });

  it('prefers <name>_source.txt over source.csv', async () => {
    await write('data/run_source.txt', 'a,b\n1,2\n');
    await write('data/source.csv', '1,2\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBe(path.join(tmp, 'data', 'run_source.txt'));
  });

  it('prefers <name>_source.dat too', async () => {
    await write('data/x_source.dat', 'row\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBe(path.join(tmp, 'data', 'x_source.dat'));
  });

  it('uses source.csv when no _source.txt and csv has meaningful lines', async () => {
    await write('data/source.csv', '# header comment\nrow1\nrow2\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBe(path.join(tmp, 'data', 'source.csv'));
  });

  it('skips source.csv when only comments + blank lines', async () => {
    await write('data/source.csv', '# only comment\n\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBeUndefined();
  });

  it('falls back to plain .txt export when no source.csv', async () => {
    await write('data/something.txt', 'row\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBe(path.join(tmp, 'data', 'something.txt'));
  });

  it('falls back to plain .dat export', async () => {
    await write('data/blob.dat', 'row\n');
    const r = await pickSourceFile(tmp);
    expect(r).toBe(path.join(tmp, 'data', 'blob.dat'));
  });

  it('returns undefined when data dir is missing', async () => {
    const r = await pickSourceFile(path.join(tmp, 'no-such'));
    expect(r).toBeUndefined();
  });
});

describe('overlayCallParams', () => {
  it('no-op when data dir is missing', async () => {
    const params: Record<string, string | number> = { p1: 'def' };
    await overlayCallParams(path.join(tmp, 'absent'), 'SubA', params);
    expect(params).toEqual({ p1: 'def' });
  });

  it('no-op when no _log.txt files present', async () => {
    await fs.mkdir(path.join(tmp, 'data'), { recursive: true });
    const params: Record<string, string | number> = { p1: 'def' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params).toEqual({ p1: 'def' });
  });

  it('overlays captured params for matching sub, coercing numeric strings to Number', async () => {
    await write('data/parent_log.txt', '__CALL__,SubA,0,p1,42,p2,hello\n');
    const params: Record<string, string | number> = { p1: 'old', p2: 'old', p3: 'keep' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params.p1).toBe(42);
    expect(params.p2).toBe('hello');
    expect(params.p3).toBe('keep');
  });

  it('keeps empty string as string (not coerced to 0)', async () => {
    await write('data/x_log.txt', '__CALL__,SubA,0,p1,\n');
    const params: Record<string, string | number> = { p1: 'old' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params.p1).toBe('');
  });

  it('ignores __CALL__ rows for other subs', async () => {
    await write('data/y_log.txt', '__CALL__,OtherSub,0,p1,99\n');
    const params: Record<string, string | number> = { p1: 'keep' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params.p1).toBe('keep');
  });

  it('first match wins (subsequent __CALL__ rows ignored)', async () => {
    await write('data/z_log.txt', '__CALL__,SubA,0,p1,1\n__CALL__,SubA,1,p1,2\n');
    const params: Record<string, string | number> = { p1: 'old' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params.p1).toBe(1);
  });

  it('ignores non-log files in data dir', async () => {
    await write('data/data.json', '{"__CALL__":"ignored"}');
    const params: Record<string, string | number> = { p1: 'keep' };
    await overlayCallParams(path.join(tmp, 'data'), 'SubA', params);
    expect(params.p1).toBe('keep');
  });
});

describe('loadSubModules', () => {
  it('returns empty map for empty subNames', async () => {
    const r = await loadSubModules(tmp, []);
    expect(r.size).toBe(0);
  });

  it('skips subs without a .ti file', async () => {
    const r = await loadSubModules(tmp, ['MissingSub']);
    expect(r.size).toBe(0);
  });

  it('loads .ti sections via splitWithMarkersOrAll', async () => {
    await write(
      'data/SubA.ti',
      '#region prolog\nPROLOG_BODY\n#endregion prolog\n#region data\nDATA_BODY\n#endregion data\n',
    );
    const r = await loadSubModules(tmp, ['SubA']);
    const m = r.get('SubA');
    expect(m).toBeDefined();
    expect(m?.sections.prolog).toBe('PROLOG_BODY');
    expect(m?.sections.data).toBe('DATA_BODY');
    expect(m?.parameterNames).toEqual([]);
  });

  it('loads .parameters.json into parameterNames, skipping blanks', async () => {
    await write('data/SubA.ti', 'just-data\n');
    await write(
      'data/SubA.parameters.json',
      JSON.stringify([{ Name: 'p1' }, { Name: '' }, { Name: 'p3' }, { other: 'x' }]),
    );
    const r = await loadSubModules(tmp, ['SubA']);
    expect(r.get('SubA')?.parameterNames).toEqual(['p1', 'p3']);
  });

  it('ignores malformed parameters JSON', async () => {
    await write('data/SubA.ti', 'x\n');
    await write('data/SubA.parameters.json', 'not json');
    const r = await loadSubModules(tmp, ['SubA']);
    expect(r.get('SubA')?.parameterNames).toEqual([]);
  });

  it('loads .variables.json and appends NValue/SValue/value_is_string', async () => {
    await write('data/SubA.ti', 'x\n');
    await write(
      'data/SubA.variables.json',
      JSON.stringify([{ Name: 'vCube' }, { Name: 'vKPI' }]),
    );
    const r = await loadSubModules(tmp, ['SubA']);
    expect(r.get('SubA')?.variableNames).toEqual([
      'vCube',
      'vKPI',
      'NValue',
      'SValue',
      'value_is_string',
    ]);
  });

  it('loads _source.txt via readCsv into source field', async () => {
    await write('data/SubA.ti', 'x\n');
    // looksLikeHeader needs at least one numeric data row under a non-numeric
    // header column, so put numbers in the body.
    await write('data/SubA_source.txt', 'col1,col2\n1,2\n3,4\n');
    const r = await loadSubModules(tmp, ['SubA']);
    const src = r.get('SubA')?.source;
    expect(src).toBeDefined();
    expect(src?.header).toEqual(['col1', 'col2']);
    expect(src?.rows.length).toBe(2);
  });

  it('returns module with source undefined when _source.txt absent', async () => {
    await write('data/SubA.ti', 'x\n');
    const r = await loadSubModules(tmp, ['SubA']);
    expect(r.get('SubA')?.source).toBeUndefined();
  });
});
