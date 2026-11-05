/**
 * Tests for simulateOne — focusing on Phase-2 sub-log merging.
 *
 * A v2 manifest with a sub-process should merge the sub's captured log into
 * the actual output before diff, so the test passes when nothing has changed.
 *
 * Limitation: sub-source regressions are NOT detected — the user must
 * re-capture after changing a sub-process's source.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// vscode is aliased via vitest.config resolve.alias → src/test/__mocks__/vscode.ts
// No manual vi.mock needed.

import { simulateOne } from '../../commands/tiTest/simulateOne';
import type { SimulateDeps } from '../../commands/tiTest/simulateTypes';
import { LastRunCache } from '../../commands/tiTest/types';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sim-cmd-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

function makeDeps(): SimulateDeps {
  const lastRun = new LastRunCache();
  return {
    treeProvider: {
      markRunning: vi.fn(),
      updateLastRun: vi.fn(),
      collectTestsBelow: vi.fn(() => []),
      getRunState: vi.fn(() => undefined),
      refresh: vi.fn(),
    } as unknown as SimulateDeps['treeProvider'],
    diffView: {
      show: vi.fn(),
      updateIfOpen: vi.fn(),
    } as unknown as SimulateDeps['diffView'],
    summaryView: {
      show: vi.fn(),
    } as unknown as SimulateDeps['summaryView'],
    lastRun,
    floatTolerance: () => 1e-9,
    maxDiffRows: () => 2000,
  };
}

/** Write a minimal v2 test folder to tmp. */
async function setupV2Folder(opts: {
  rootTi: string;
  subName: string;
  subLogContent: string;
  rootLogContent?: string;
}): Promise<void> {
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(
    path.join(tmp, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      version: 2,
      kind: 'ti-test',
      name: 'sub-merge-test',
      process: 'RootProc',
      active: true,
      captured: { at: '2026-01-01T00:00:00Z', server: 'test', extensionVersion: '1.0.0' },
      datasourceType: 'None',
      writeTargets: { cubes: [], dimensions: [] },
      subs: [opts.subName],
    }),
    'utf8',
  );

  await fs.writeFile(path.join(dataDir, 'process.ti'), opts.rootTi, 'utf8');
  await fs.writeFile(path.join(dataDir, 'parameters.json'), '[]', 'utf8');
  await fs.writeFile(path.join(dataDir, `${opts.subName}_log.txt`), opts.subLogContent, 'utf8');

  if (opts.rootLogContent !== undefined) {
    await fs.writeFile(path.join(dataDir, 'RootProc_log.txt'), opts.rootLogContent, 'utf8');
  }
}

describe('simulateOne — Phase-2 sub-log merge', () => {
  it('PASS: sub CellPutN in captured log matches expected; root process is empty', async () => {
    // Spec: v2 manifest + 1 sub, root process = `LogOutput('INFO', 'X');` (no cell writes),
    // sub_log.txt has 1 CellPutN row, root_log.txt is empty.
    // Expected (from readExpectedDimDeltas union of *_log.txt):
    //   sub_log.txt contributes the CellPutN row.
    // Actual (from simulator + appendRow):
    //   simulator produces nothing; appendRow merges sub_log.txt → same CellPutN row.
    // → expected == actual → PASS.
    await setupV2Folder({
      rootTi: `#region data\nLogOutput('INFO', 'X');\n#endregion data`,
      subName: 'SubProc',
      subLogContent: `CellPutN,MyCube,Jan,Umsatz,100\n`,
      rootLogContent: '', // empty root log
    });

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(true);
  });

  it('PASS: sub CellPutN visible in both expected and actual (no root_log.txt)', async () => {
    // No root_log.txt at all — sub_log.txt is the only log file.
    // readExpectedDimDeltas picks it up via *_log.txt glob → expected has CellPutN.
    // appendRow also merges sub_log.txt into actual → actual has same CellPutN.
    await setupV2Folder({
      rootTi: `#region data\n\n#endregion data`,
      subName: 'SubProc',
      subLogContent: `CellPutN,MyCube,Jan,Umsatz,42\n`,
    });

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(true);
  });

  it('PASS: missing sub-log file is silently skipped — no crash', async () => {
    const dataDir = path.join(tmp, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    await fs.writeFile(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: 2,
        kind: 'ti-test',
        name: 'missing-sub',
        process: 'RootProc',
        active: true,
        captured: { at: '2026-01-01T00:00:00Z', server: 'test', extensionVersion: '1.0.0' },
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['NonExistentSub'],
      }),
      'utf8',
    );
    await fs.writeFile(path.join(dataDir, 'process.ti'), '#region data\n\n#endregion data', 'utf8');
    await fs.writeFile(path.join(dataDir, 'parameters.json'), '[]', 'utf8');
    // No sub_log.txt written — should be silently skipped.

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(true);
  });

  it('Phase 2.5: sub-mode simulates a single sub from parent data folder', async () => {
    // Phase 2.5 UI: clicking a virtual sub-node (subs/<name>/ may be empty)
    // runs JUST that sub. Expected = <sub>_log.txt; actual = simulator output
    // for that sub's TI iterating its captured source rows. No root execution.
    const dataDir = path.join(tmp, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    // Root manifest declares the sub
    await fs.writeFile(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: 2,
        kind: 'ti-test',
        name: 'Root',
        process: 'Root',
        active: true,
        captured: { at: '2026-01-01T00:00:00Z', server: 'test', extensionVersion: '1.0.0' },
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['Mini'],
      }),
      'utf8',
    );

    // Sub data files in parent's data/ folder
    await fs.writeFile(
      path.join(dataDir, 'Mini.ti'),
      `#region data\nCellPutN(vAmount, 'CubeM', vKey);\n#endregion data`,
      'utf8',
    );
    await fs.writeFile(
      path.join(dataDir, 'Mini.parameters.json'),
      '[]',
      'utf8',
    );
    await fs.writeFile(
      path.join(dataDir, 'Mini.variables.json'),
      JSON.stringify([
        { Name: 'vKey', Type: 'String', Position: 1 },
        { Name: 'vAmount', Type: 'Numeric', Position: 2 },
      ]),
      'utf8',
    );
    await fs.writeFile(
      path.join(dataDir, 'Mini_source.txt'),
      `"A";"10"\n"B";"20"\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(dataDir, 'Mini_log.txt'),
      `"CellPutN";"CubeM";"A";"10"\n"CellPutN";"CubeM";"B";"20"\n`,
      'utf8',
    );

    // Virtual sub folder — no on-disk manifest.json here
    const subFolder = path.join(tmp, 'subs', 'Mini');

    const deps = makeDeps();
    const out = await simulateOne(deps, subFolder);
    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(true);
  });

  it('Phase 2.5: sub-mode detects regression — modified sub source produces diff', async () => {
    const dataDir = path.join(tmp, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    await fs.writeFile(
      path.join(tmp, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: 2,
        kind: 'ti-test',
        name: 'Root',
        process: 'Root',
        active: true,
        captured: { at: '2026-01-01T00:00:00Z', server: 'test', extensionVersion: '1.0.0' },
        datasourceType: 'None',
        writeTargets: { cubes: [], dimensions: [] },
        subs: ['Mini'],
      }),
      'utf8',
    );
    // Sub writes value+1 → diverges from captured log
    await fs.writeFile(
      path.join(dataDir, 'Mini.ti'),
      `#region data\nCellPutN(vAmount + 1, 'CubeM', vKey);\n#endregion data`,
      'utf8',
    );
    await fs.writeFile(path.join(dataDir, 'Mini.parameters.json'), '[]', 'utf8');
    await fs.writeFile(
      path.join(dataDir, 'Mini.variables.json'),
      JSON.stringify([{ Name: 'vKey', Type: 'String', Position: 1 }, { Name: 'vAmount', Type: 'Numeric', Position: 2 }]),
      'utf8',
    );
    await fs.writeFile(path.join(dataDir, 'Mini_source.txt'), `"A";"10"\n`, 'utf8');
    await fs.writeFile(path.join(dataDir, 'Mini_log.txt'), `"CellPutN";"CubeM";"A";"10"\n`, 'utf8');

    const subFolder = path.join(tmp, 'subs', 'Mini');
    const deps = makeDeps();
    const out = await simulateOne(deps, subFolder);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(false);
    expect(out.row.summary.cellDiffs).toBeGreaterThan(0);
  });

  it('Phase 2.5: sub source on disk is recursively simulated (not log-merged)', async () => {
    // Root TI calls ExecuteProcess('SubProc'). Sub source on disk writes
    // CellPutN(100, 'MyCube', 'Jan', 'Umsatz'). Sub log says value=999 (stale).
    // If simulator descends → actual = 100 (live). Expected = 999 (log).
    // → diff visible → FAIL (proves source ran, log was IGNORED).
    await setupV2Folder({
      rootTi: `#region prolog\nExecuteProcess('SubProc');\n#endregion prolog`,
      subName: 'SubProc',
      subLogContent: `CellPutN,MyCube,Jan,Umsatz,999\n`,
      rootLogContent: '',
    });
    const dataDir = path.join(tmp, 'data');
    await fs.writeFile(
      path.join(dataDir, 'SubProc.ti'),
      `#region prolog\nCellPutN(100, 'MyCube', 'Jan', 'Umsatz');\n#endregion prolog`,
      'utf8',
    );
    await fs.writeFile(path.join(dataDir, 'SubProc.parameters.json'), '[]', 'utf8');

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(false);
    expect(out.row.summary.cellDiffs).toBeGreaterThan(0);
  });

  it('Phase 2.5: sub source missing → falls back to log-merge (Phase-2 behaviour)', async () => {
    // No SubProc.ti on disk → loader returns undefined → log-merge runs.
    await setupV2Folder({
      rootTi: `#region prolog\nExecuteProcess('SubProc');\n#endregion prolog`,
      subName: 'SubProc',
      subLogContent: `CellPutN,MyCube,Jan,Umsatz,42\n`,
    });

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    expect(out.row.error).toBeUndefined();
    expect(out.row.pass).toBe(true);
  });

  it('FAIL: sub CellPutN in expected but root writes different value → diff detected', async () => {
    // Root process writes value 999; sub log (expected baseline) has value 100.
    // After merge: actual has both the root cell (999) AND sub cell (100 → same key → overwritten to 999).
    // Actually root and sub use different cubes here so we can verify the cell diff properly.
    await setupV2Folder({
      rootTi: `#region data\nCellPutN(999, 'MyCube', 'Jan', 'Umsatz');\n#endregion data`,
      subName: 'SubProc',
      subLogContent: `CellPutN,OtherCube,Jan,Umsatz,100\n`,
      rootLogContent: `CellPutN,MyCube,Jan,Umsatz,100\n`, // expected root value is 100
    });

    const deps = makeDeps();
    const out = await simulateOne(deps, tmp);

    // Root actual = 999, expected = 100 → cell diff → FAIL
    expect(out.row.pass).toBe(false);
  });
});
