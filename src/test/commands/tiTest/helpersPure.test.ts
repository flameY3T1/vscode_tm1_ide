import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  detectLiteralCubes,
  detectLiteralDims,
  scanSubProcessCalls,
  fileExists,
  CELL_WRITE_FUNC_NAMES,
  SUB_PROCESS_CALL_NAMES,
  DIM_READ_FUNC_NAMES,
} from '../../../commands/tiTest/helpers';

describe('CELL_WRITE_FUNC_NAMES', () => {
  it('contains the three TM1 cell-write functions', () => {
    expect(CELL_WRITE_FUNC_NAMES.has('cellputn')).toBe(true);
    expect(CELL_WRITE_FUNC_NAMES.has('cellputs')).toBe(true);
    expect(CELL_WRITE_FUNC_NAMES.has('cellincrementn')).toBe(true);
  });
});

describe('SUB_PROCESS_CALL_NAMES', () => {
  it('contains ExecuteProcess and ExecuteCommand (lowercased)', () => {
    expect(SUB_PROCESS_CALL_NAMES.has('executeprocess')).toBe(true);
    expect(SUB_PROCESS_CALL_NAMES.has('executecommand')).toBe(true);
  });
});

describe('DIM_READ_FUNC_NAMES', () => {
  it('contains direct dim-read functions (lowercased)', () => {
    for (const f of ['dimix', 'elementindex', 'elpar', 'attrs', 'attrn', 'subsetgetsize']) {
      expect(DIM_READ_FUNC_NAMES.has(f)).toBe(true);
    }
  });
});

describe('detectLiteralDims', () => {
  it('returns empty when no dim-read calls present', () => {
    expect(detectLiteralDims(emptyProcess({ data: 'i := 1;' }))).toEqual([]);
  });
  it('extracts the literal dim from the 1st arg of dim-read calls', () => {
    const src = emptyProcess({
      prolog: "nI = DIMIX('DemoDim', 'E1');",
      data: "sP = ELPAR('DemoDim', 'E1', 1);\r\nsA = ATTRS('OtherDim', 'E2', 'Desc');",
    });
    expect(detectLiteralDims(src)).toEqual(['DemoDim', 'OtherDim']);
  });
  it('ignores non-literal (variable) dim args and unescapes doubled quotes', () => {
    const src = emptyProcess({
      data: "nI = ElementIndex(sDim, '', 'E1');\r\nnJ = DIMSIZ('Dim''s');",
    });
    expect(detectLiteralDims(src)).toEqual(["Dim's"]);
  });
  it('finds dim-read calls nested inside other calls, e.g. IF(DIMIX(...))', () => {
    const src = emptyProcess({
      data: "IF(DIMIX('DemoDim', vElem)=0);\r\nitemskip;\r\nENDIF;",
    });
    expect(detectLiteralDims(src)).toEqual(['DemoDim']);
  });
});

function emptyProcess(over?: Partial<{ prolog: string; metadata: string; data: string; epilog: string }>) {
  return {
    prolog: over?.prolog ?? '',
    metadata: over?.metadata ?? '',
    data: over?.data ?? '',
    epilog: over?.epilog ?? '',
    datasource: { Type: 'None' },
    parameters: [],
    variables: [],
  };
}

describe('detectLiteralCubes', () => {
  it('returns empty array when no cell-write calls present', () => {
    const cubes = detectLiteralCubes(emptyProcess({ data: 'i := 1;' }));
    expect(cubes).toEqual([]);
  });

  it('extracts literal cube from CellPutN second arg', () => {
    const src = emptyProcess({ data: "CellPutN(100, 'Sales', 'Jan', 'Plan');" });
    expect(detectLiteralCubes(src)).toEqual(['Sales']);
  });

  it('extracts cubes across all four sections', () => {
    const src = emptyProcess({
      prolog: "CellPutS('x', 'PrologCube', 'A');",
      metadata: "CellPutN(1, 'MetadataCube', 'A');",
      data: "CellPutN(2, 'DataCube', 'A');",
      epilog: "CellIncrementN(3, 'EpilogCube', 'A');",
    });
    expect(detectLiteralCubes(src)).toEqual(['DataCube', 'EpilogCube', 'MetadataCube', 'PrologCube']);
  });

  it('deduplicates same cube appearing multiple times', () => {
    const src = emptyProcess({
      data: "CellPutN(1, 'Plan', 'A'); CellPutN(2, 'Plan', 'B');",
    });
    expect(detectLiteralCubes(src)).toEqual(['Plan']);
  });

  it('ignores non-literal (variable) second arg', () => {
    const src = emptyProcess({ data: "CellPutN(1, cubeName, 'A');" });
    expect(detectLiteralCubes(src)).toEqual([]);
  });

  it('handles escaped single quote (TI doubled-quote convention)', () => {
    const src = emptyProcess({ data: "CellPutN(1, 'Plan''s Cube', 'A');" });
    expect(detectLiteralCubes(src)).toEqual(["Plan's Cube"]);
  });
});

describe('scanSubProcessCalls', () => {
  it('returns empty when no ExecuteProcess/ExecuteCommand calls', () => {
    expect(scanSubProcessCalls(emptyProcess({ data: 'i := 1;' }))).toEqual([]);
  });

  it('detects ExecuteProcess call with section + 1-based line', () => {
    const src = emptyProcess({
      prolog: "\nExecuteProcess('Sub', 'p', 1);\n",
    });
    const calls = scanSubProcessCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].section).toBe('prolog');
    expect(calls[0].call).toBe('ExecuteProcess');
    expect(calls[0].line).toBe(2);
  });

  it('detects ExecuteCommand (case-insensitive)', () => {
    const src = emptyProcess({ data: "executecommand('cmd', 0);" });
    const calls = scanSubProcessCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].section).toBe('data');
    expect(calls[0].call.toLowerCase()).toBe('executecommand');
  });

  it('reports multiple sub-calls across sections in order', () => {
    const src = emptyProcess({
      prolog: "ExecuteProcess('A');",
      data: "ExecuteProcess('B');",
      epilog: "ExecuteCommand('C', 0);",
    });
    const calls = scanSubProcessCalls(src);
    expect(calls.map(c => c.section)).toEqual(['prolog', 'data', 'epilog']);
  });

  it('skips empty body sections without error', () => {
    expect(scanSubProcessCalls(emptyProcess())).toEqual([]);
  });
});

describe('fileExists', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fileExists-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('returns true for existing file', async () => {
    const f = path.join(tmp, 'x.txt');
    await fs.writeFile(f, 'data');
    expect(await fileExists(f)).toBe(true);
  });

  it('returns true for existing directory', async () => {
    expect(await fileExists(tmp)).toBe(true);
  });

  it('returns false for non-existent path', async () => {
    expect(await fileExists(path.join(tmp, 'does-not-exist'))).toBe(false);
  });
});
