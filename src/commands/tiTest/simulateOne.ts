import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { runProcess } from '../../tiSimulator/runner/processRunner';
import { readCsv } from '../../tiSimulator/source/csvSource';
import { expectedToAggregated } from '../../tiSimulator/output/csvOutputIo';
import { diffCells } from '../../tiTestFramework/diff/cellDiff';
import {
  diffOpList,
  dimOpKey,
  attrOpKey,
  subsetOpKey,
  viewOpKey,
  cubeOpKey,
  tranOpKey,
  metaOpKey,
} from '../../tiTestFramework/diff/dimDiff';
import { aggregateLog } from '../../tiTestFramework/log/logAggregator';
import { parseLog } from '../../tiTestFramework/log/logParser';
import { KNOWN_OPS, type LogRow } from '../../tiTestFramework/log/logSchema';
import { summarize, capDiffResult, type DiffResult } from '../../tiTestFramework/diff/diffResult';
import { readManifest, isRootManifest } from '../../tiTestFramework/storage/manifestIo';
import type { SummaryRow } from '../../webviews/renderSummaryHtml';
import type { Value } from '../../tiSimulator/types';
import type { SubProcessLoader } from '../../tiSimulator/eval/subProcess';
import { fileExists } from './helpers';
import {
  loadCubeDims,
  loadFixtures,
  loadParameters,
  loadProcessSections,
  loadSubModules,
  loadVariableNames,
  overlayCallParams,
  pickSourceFile,
  splitWithMarkersOrAll,
} from './loaders';
import { readExpectedDimDeltas, readExpectedFromAny } from './expected';
import { detectSubMode } from './mode';
import type { SimulateDeps, SimulateOneOutcome } from './simulateTypes';

export async function simulateOne(deps: SimulateDeps, testFolder: string): Promise<SimulateOneOutcome> {
  const t0 = Date.now();
  const baseRow: SummaryRow = {
    testFolder,
    testName: path.basename(testFolder),
    pass: false,
    summary: {
      pass: false,
      totalDiffs: 0,
      cellDiffs: 0,
      dimDiffs: 0,
      attrDiffs: 0,
      subsetDiffs: 0,
      viewDiffs: 0,
      cubeDiffs: 0,
      tranDiffs: 0,
      metaDiffs: 0,
      statusDiff: false,
    },
    durationMs: 0,
  };

  const subInfo = await detectSubMode(testFolder);
  if (subInfo) {
    return simulateSubMode(deps, testFolder, subInfo, t0, baseRow);
  }

  let manifest;
  try {
    manifest = await readManifest(testFolder);
    baseRow.testName = manifest.name ?? baseRow.testName;
  } catch (e) {
    return {
      row: { ...baseRow, durationMs: Date.now() - t0, error: `Manifest read failed: ${(e as Error).message}` },
      warnings: [],
      parseErrors: [],
    };
  }

  const sections = await loadProcessSections(testFolder);
  if (!sections) {
    return {
      row: {
        ...baseRow,
        durationMs: Date.now() - t0,
        error: `No process.ti or per-section *.ti files in ${path.join(testFolder, 'input')}.`,
      },
      manifest,
      warnings: [],
      parseErrors: [],
    };
  }

  const sourceFile = await pickSourceFile(testFolder);
  const source = sourceFile ? await readCsv(sourceFile) : undefined;
  const parameters = await loadParameters(testFolder);
  const variableNames = await loadVariableNames(testFolder);
  const fixtures = await loadFixtures(testFolder);
  // Root-only fields (process, captured, subs) live on the Legacy/Root manifest
  // variants; narrow with the type guard rather than ad-hoc casts.
  if (isRootManifest(manifest)) {
    // GetProcessName() resolves to the ORIGINAL process name (matches the live
    // capture, whose helper rewrites GetProcessName() to the same literal).
    fixtures.processName = manifest.process ?? '';
    // Older captures carry no version; they were all taken before v12 support.
    fixtures.v12 = manifest.captured?.tm1Version === 'v12';
    // Now()/Today()/TimSt() resolve to the CAPTURE time, so a `TIMST(NOW())`
    // timestamp baked into a filename/value reproduces the captured one on any day.
    const capturedAt = manifest.captured?.at;
    const capturedDate = capturedAt ? new Date(capturedAt) : undefined;
    if (capturedDate && !Number.isNaN(capturedDate.getTime())) fixtures.now = capturedDate;
  } else {
    fixtures.processName = '';
  }

  // Phase 2.5: pre-load any sub-source modules so ExecuteProcess recurses.
  // `subs` is a RootManifestV2-only field (v2 discriminator).
  const manifestSubsForLoader: string[] =
    isRootManifest(manifest) && 'version' in manifest && manifest.version === 2
      ? (manifest.subs ?? [])
      : [];
  const subModules = await loadSubModules(testFolder, manifestSubsForLoader);
  const subProcessLoader: SubProcessLoader | undefined =
    subModules.size > 0 ? (name) => subModules.get(name) : undefined;

  deps.treeProvider.markRunning(testFolder);
  await yieldToUi();
  let result;
  try {
    result = runProcess({ sections, parameters, source, variableNames, fixtures, subProcessLoader });
  } catch (e) {
    deps.treeProvider.updateLastRun(testFolder, false);
    return {
      row: { ...baseRow, durationMs: Date.now() - t0, error: `Simulator crashed: ${(e as Error).message}` },
      manifest,
      warnings: [],
      parseErrors: [],
    };
  }

  // Phase-2 fallback: merge captured sub-log for subs WITHOUT source on disk.
  // Phase 2.5: subs that have `data/<name>.ti` are recursively simulated above
  // (via subProcessLoader) and produce their own typed output — re-merging the
  // log would double-count.
  if (manifestSubsForLoader.length > 0) {
    for (const subName of manifestSubsForLoader) {
      if (subModules.has(subName)) continue; // simulated; skip log-merge
      const subLogPath = path.join(testFolder, 'data', `${subName}_log.txt`);
      try {
        const subLogText = await fs.readFile(subLogPath, 'utf8');
        const subParsed = parseLog(subLogText);
        for (const row of subParsed.rows) {
          result.output.appendRow(row);
        }
      } catch {
        /* sub-log missing — user must re-capture */
      }
    }
  }

  const expectedRaw = await readExpectedFromAny(testFolder);
  // Filter out rows whose first column is a typed-op name (e.g. AttrInsert,
  // CubeDestroy). These sneak in when the user copies a typed-row log file
  // into a cell-CSV slot — the cell parser would otherwise mis-render them
  // as cubes named "AttrInsert" with the args as coords.
  const expected = expectedRaw.filter((r) => !KNOWN_OPS.has(r.cube));
  const expectedAgg = expectedToAggregated(expected);

  // Always diff sim's emitted typed rows against the captured expected log.
  // When no expected file exists the sim rows surface as `extra` (+) entries,
  // giving the user visibility into what the simulator actually did.
  // Capture-time instrumentation markers are dropped by aggregateLog itself.
  const expectedOpAgg = aggregateLog(await readExpectedDimDeltas(testFolder));
  const actualOpAgg = aggregateLog(result.output.getOpRows());

  // Helper-log `*_log.txt` may carry CellPutN / CellPutS / CellIncrementN
  // rows alongside dim/attr ops. aggregateLog routes them into `cells`.
  // Merge them into `expectedAgg` so cellDiff sees them — output.csv is
  // optional once a typed log exists. Existing output.csv entries win on
  // key collisions (explicit user data overrides logged side-effects).
  for (const [key, agg] of expectedOpAgg.cells) {
    if (!expectedAgg.has(key)) expectedAgg.set(key, agg);
  }

  const actualAgg = result.output.getAggregated();
  const diffResult = capDiffResult(
    _buildDiffResult(expectedOpAgg, actualOpAgg, expectedAgg, actualAgg, deps.floatTolerance()),
    deps.maxDiffRows(),
  );
  const summary = summarize(diffResult);

  deps.lastRun.set(testFolder, { manifest, diff: diffResult, summary });
  deps.treeProvider.updateLastRun(testFolder, summary.pass);

  const cubeDims = await loadCubeDims(testFolder);

  return {
    row: {
      testFolder,
      testName: manifest.name,
      pass: summary.pass,
      summary,
      durationMs: Date.now() - t0,
    },
    manifest,
    diffResult,
    cubeDims,
    warnings: result.warnings.map((w) => w.message),
    parseErrors: result.parseErrors.map((e) => `${e.section}:${e.line} ${e.message}`),
  };
}

/**
 * Phase 2.5 sub-mode: simulate a single sub-process in isolation, using
 * source/variables/log files stored flat in the parent test's data/ folder.
 * Designed for the tree-view sub-node click — root TI is NOT executed.
 */
async function simulateSubMode(
  deps: SimulateDeps,
  subFolder: string,
  info: { parentFolder: string; subName: string },
  t0: number,
  baseRow: SummaryRow,
): Promise<SimulateOneOutcome> {
  const { parentFolder, subName } = info;
  baseRow.testName = subName;
  const dataDir = path.join(parentFolder, 'data');
  const tiPath = path.join(dataDir, `${subName}.ti`);
  if (!(await fileExists(tiPath))) {
    return {
      row: { ...baseRow, durationMs: Date.now() - t0, error: `Sub source missing: ${tiPath}` },
      warnings: [],
      parseErrors: [],
    };
  }
  const sections = splitWithMarkersOrAll(await fs.readFile(tiPath, 'utf8'));

  // Source rows for DataSource iteration (optional)
  const sourcePath = path.join(dataDir, `${subName}_source.txt`);
  const source = (await fileExists(sourcePath)) ? await readCsv(sourcePath).catch(() => undefined) : undefined;

  const variableNames = await _loadSubVariableNames(dataDir, subName);
  const parameters = await _loadSubParameters(dataDir, subName);
  const fixtures = await loadFixtures(parentFolder);

  // Overlay captured invocation params (from a parent's `__CALL__` marker)
  // over the design defaults. Bedrock helpers (e.g. }bedrock.cube.view.create)
  // have empty defaults and would ProcessBreak immediately without these.
  await overlayCallParams(dataDir, subName, parameters);

  deps.treeProvider.markRunning(subFolder);
  await yieldToUi();
  let result;
  try {
    result = runProcess({ sections, parameters, source, variableNames, fixtures });
  } catch (e) {
    deps.treeProvider.updateLastRun(subFolder, false);
    return {
      row: { ...baseRow, durationMs: Date.now() - t0, error: `Simulator crashed: ${(e as Error).message}` },
      warnings: [],
      parseErrors: [],
    };
  }

  const expectedOpAgg = aggregateLog(await _loadSubExpectedRows(dataDir, subName));
  const actualOpAgg = aggregateLog(result.output.getOpRows());

  // Cell expectations come from typed-row log (CellPutN/S/Increment).
  const expectedAgg = new Map(expectedOpAgg.cells);
  const actualAgg = result.output.getAggregated();
  const diffResult = capDiffResult(
    _buildDiffResult(expectedOpAgg, actualOpAgg, expectedAgg, actualAgg, deps.floatTolerance()),
    deps.maxDiffRows(),
  );
  const summary = summarize(diffResult);

  // Synthesise a minimal sub manifest for the diff view and lastRun cache.
  const subManifest = {
    version: 2 as const,
    kind: 'ti-test-sub' as const,
    name: subName,
    parent: '../..',
    rootTest: subName,
    clonedFrom: subName,
    parameters: [] as { name: string; type: 'N' | 'S'; value: string | number }[],
    callContext: { callerProcess: subName, callerLine: 0, callIndex: 0 },
    active: true,
  };
  deps.lastRun.set(subFolder, { manifest: subManifest, diff: diffResult, summary });
  deps.treeProvider.updateLastRun(subFolder, summary.pass);

  return {
    row: {
      testFolder: subFolder,
      testName: subName,
      pass: summary.pass,
      summary,
      durationMs: Date.now() - t0,
    },
    manifest: subManifest,
    diffResult,
    cubeDims: await loadCubeDims(parentFolder),
    warnings: result.warnings.map((w) => w.message),
    parseErrors: result.parseErrors.map((e) => `${e.section}:${e.line} ${e.message}`),
  };
}

// ---------------------------------------------------------------------------
// Private helpers (shared by simulateOne + simulateSubMode)
// ---------------------------------------------------------------------------

type OpAgg = ReturnType<typeof aggregateLog>;
type CellAgg = OpAgg['cells'];

/** Build a fully-populated DiffResult from already-aggregated expected/actual data. */
function _buildDiffResult(
  expectedOpAgg: OpAgg,
  actualOpAgg: OpAgg,
  expectedAgg: CellAgg,
  actualAgg: CellAgg,
  floatTolerance: number,
): DiffResult {
  const cell = diffCells(expectedAgg, actualAgg, { floatTolerance });
  return {
    cell,
    dim:    diffOpList(expectedOpAgg.dimOps,    actualOpAgg.dimOps,    dimOpKey),
    attr:   diffOpList(expectedOpAgg.attrOps,   actualOpAgg.attrOps,   attrOpKey),
    subset: diffOpList(expectedOpAgg.subsetOps, actualOpAgg.subsetOps, subsetOpKey),
    view:   diffOpList(expectedOpAgg.viewOps,   actualOpAgg.viewOps,   viewOpKey),
    cube:   diffOpList(expectedOpAgg.cubeOps,   actualOpAgg.cubeOps,   cubeOpKey),
    tran:   diffOpList(expectedOpAgg.tranOps,   actualOpAgg.tranOps,   tranOpKey),
    meta:   diffOpList(expectedOpAgg.metaOps,   actualOpAgg.metaOps,   metaOpKey),
    status: {
      equal: true,
      statusMatch: true,
      errorLogMatch: true,
      expected: { status: 'success', errorLogContent: '' },
      actual:   { status: 'success', errorLogContent: '' },
    },
  };
}

/**
 * Load variable names from `<sub>.variables.json` (Name[] in order). Mirrors the
 * recursive-loader behavior (loadSubModules) by appending `NValue`/`SValue`/
 * `value_is_string` so cube-view DataSource auto-vars resolve from the 3 extra
 * columns the capture rewriter dumped.
 */
async function _loadSubVariableNames(dataDir: string, subName: string): Promise<string[] | undefined> {
  const varsPath = path.join(dataDir, `${subName}.variables.json`);
  if (!(await fileExists(varsPath))) return undefined;
  try {
    const raw = await fs.readFile(varsPath, 'utf8');
    const parsed = JSON.parse(raw) as { Name?: string }[];
    if (!Array.isArray(parsed)) return undefined;
    return [
      ...parsed.map((v) => v?.Name ?? '').filter((n) => n.length > 0),
      'NValue',
      'SValue',
      'value_is_string',
    ];
  } catch {
    return undefined;
  }
}

/** Load parameters from `<sub>.parameters.json` (Name+Value entries). */
async function _loadSubParameters(dataDir: string, subName: string): Promise<Record<string, Value>> {
  const parameters: Record<string, Value> = {};
  const paramPath = path.join(dataDir, `${subName}.parameters.json`);
  if (!(await fileExists(paramPath))) return parameters;
  try {
    const raw = await fs.readFile(paramPath, 'utf8');
    const parsed = JSON.parse(raw) as { Name?: string; Value?: Value }[];
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        if (p?.Name) parameters[p.Name] = p.Value ?? '';
      }
    }
  } catch {
    /* ignore */
  }
  return parameters;
}

/** Read `<sub>_log.txt` and parse to LogRow[]. Empty array if missing/unparsable. */
async function _loadSubExpectedRows(dataDir: string, subName: string): Promise<LogRow[]> {
  const logPath = path.join(dataDir, `${subName}_log.txt`);
  if (!(await fileExists(logPath))) return [];
  try {
    const text = await fs.readFile(logPath, 'utf8');
    return parseLog(text).rows;
  } catch {
    return [];
  }
}

/**
 * Let the tree and the progress notification paint before the simulator runs
 * synchronously — without it the "running" state was set and cleared in the
 * same blocked stretch and never showed.
 * shortcut: the run itself still blocks the extension host (30 s on a
 * 1.8M-row production test); a worker thread would lift that.
 */
function yieldToUi(): Promise<void> {
  // A round trip, not one tick: the tree repaints only after the window asks back for its items.
  return new Promise((resolve) => setTimeout(resolve, 50));
}
