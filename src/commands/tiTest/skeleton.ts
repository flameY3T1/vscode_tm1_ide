import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { rewriteSource } from '../../tiTestFramework/rewriter/tiSourceRewriter';
import { instrumentReads } from '../../tiTestFramework/rewriter/instrumentReads';
import { LOG_FILE_VAR } from '../../tiTestFramework/rewriter/wrapperCode';
import { escapeODataKey } from '../../utils/odataKey';
import {
  writeManifest,
  type LegacyManifestV1,
  type Manifest,
} from '../../tiTestFramework/storage/manifestIo';
import { buildFixtureBundle, fileExists } from './helpers';
import type { HelperRunResult, ProcessFetchResult, WriteSkeletonInput } from './types';

export async function writeSimulatorTestSkeleton(input: WriteSkeletonInput): Promise<HelperRunResult> {
  const { testFolder, testName, processName, processSrc, params, serverName, extensionVersion } = input;
  const dataDir = path.join(testFolder, 'data');
  const helperDir = path.join(testFolder, 'TI');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(helperDir, { recursive: true });

  const processTi = [
    `#region prolog\n${processSrc.prolog}\n#endregion prolog`,
    `#region metadata\n${processSrc.metadata}\n#endregion metadata`,
    `#region data\n${processSrc.data}\n#endregion data`,
    `#region epilog\n${processSrc.epilog}\n#endregion epilog`,
  ].join('\n\n');
  await fs.writeFile(path.join(dataDir, 'process.ti'), processTi, 'utf8');

  await fs.writeFile(
    path.join(dataDir, 'parameters.json'),
    JSON.stringify(params, null, 2) + '\n',
    'utf8',
  );

  await fs.writeFile(
    path.join(dataDir, 'variables.json'),
    JSON.stringify(
      processSrc.variables.map((v) => ({ Name: v.Name, Type: v.Type })),
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const bundle = input.cfg
    ? await buildFixtureBundle(input.cfg, [processSrc])
    : { cubeDims: {}, dimFixtures: {}, dimAttrs: {} };
  await fs.writeFile(
    path.join(dataDir, 'cube-dims.json'),
    JSON.stringify(bundle.cubeDims, null, 2) + '\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(dataDir, 'dim-fixtures.json'),
    JSON.stringify(bundle.dimFixtures, null, 2) + '\n',
    'utf8',
  );

  const cubeFx = path.join(dataDir, 'cube-fixtures.jsonl');
  if (!(await fileExists(cubeFx))) {
    await fs.writeFile(
      cubeFx,
      `# CellGetN/CellGetS fixtures — one JSON object per line\n` +
        `# {"cube":"<cube>","coord":["e1","e2",...],"value":<number-or-string>}\n`,
      'utf8',
    );
  }

  // dim-attributes.json: { "<dim>": { "<elem>": { "<attr>": value } } } — powers
  // ATTRS/AttrN/ElementAttr* in the simulator. Only overwrite when the refresh
  // actually found attributes, so a hand-authored file isn't clobbered with {}.
  const attrFx = path.join(dataDir, 'dim-attributes.json');
  if (Object.keys(bundle.dimAttrs).length > 0) {
    await fs.writeFile(attrFx, JSON.stringify(bundle.dimAttrs, null, 2) + '\n', 'utf8');
  } else if (!(await fileExists(attrFx))) {
    await fs.writeFile(attrFx, '{}\n', 'utf8');
  }

  const helperResult = await writeHelperTi(
    helperDir,
    processName,
    processSrc,
    params,
    input.cfg?.version === 'v12',
  );

  await fs.writeFile(
    path.join(testFolder, 'README.md'),
    buildTestReadme(processName, testName),
    'utf8',
  );

  const dsType = String(processSrc.datasource?.Type ?? 'None').toLowerCase();
  const datasourceType: LegacyManifestV1['datasourceType'] = dsType.includes('view')
    ? 'View'
    : dsType.includes('subset')
      ? 'Subset'
      : dsType.includes('ascii') || dsType.includes('file')
        ? 'File'
        : 'None';

  const manifest: Manifest = {
    schemaVersion: 1,
    name: testName,
    process: processName,
    active: true,
    captured: {
      at: new Date().toISOString(),
      server: serverName,
      extensionVersion: extensionVersion,
      ...(input.cfg ? { tm1Version: input.cfg.version === 'v12' ? 'v12' : 'v11' } : {}),
    },
    datasourceType,
    writeTargets: { cubes: [], dimensions: [] },
  };
  await writeManifest(testFolder, manifest);

  const srcStub = path.join(dataDir, 'source.csv');
  const outStub = path.join(dataDir, 'output.csv');
  if (!(await fileExists(srcStub))) {
    await fs.writeFile(
      srcStub,
      `# replace with rows from your view export. one row per CSV line\n`,
      'utf8',
    );
  }
  if (!(await fileExists(outStub))) {
    await fs.writeFile(
      outStub,
      `# replace with CellPutN output rows: cube,e1,e2,...,eN,value (one per line)\n`,
      'utf8',
    );
  }

  return helperResult;
}

export async function writeHelperTi(
  helperDir: string,
  processName: string,
  src: ProcessFetchResult,
  params: { Name: string; Value: string | number }[],
  v12 = false,
): Promise<HelperRunResult> {
  const safeBase = processName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 56);
  const helperName = `${safeBase}_TI`.slice(0, 60);
  const fileBase = safeBase;
  // Write into the ProcessError dir with a `TM1ProcessError_*.log` name: only
  // files matching that pattern are enumerated by the `ErrorLogFiles` OData
  // collection and thus readable back via `ErrorLogFiles('<name>')/Content`
  // (live-verified TM1 11.8 — a plain `<base>_log.txt` name is NOT visible to
  // REST). The extension strips the prefix + `.log` when importing into data/.
  // v12 cannot serve that dir back (`ErrorLogFiles` lists only its own
  // `ProcessLog_*.jsonl`), so there the bare name lands in the `Files` space.
  const logDir = v12 ? '' : 'GetProcessErrorFileDirectory() | ';
  const logFileLit = `${logDir}'TM1ProcessError_${fileBase}_output.log'`;

  // Optional: still capture iterated source rows to a separate file (legacy
  // UX). Only emitted if the source has detected variables.
  const sourceDumpStmt =
    src.variables.length > 0
      ? `TextOutput(${logDir}'TM1ProcessError_${fileBase}_source.log', ${src.variables
          .map((v) => (v.Type === 'Numeric' ? `NumberToString(${v.Name})` : v.Name))
          .join(', ')});`
      : `### no source variables detected — add a manual TextOutput here if your process iterates a source ###`;

  // Apply the FULL TI-rewriter to every section. Every TM1-mutation TI
  // builtin (~75 of them — Cell*, AttrInsert, CubeDestroy, ViewMDXSet,
  // HierarchySubsetCreate, …) gets a `TextOutput(sLogFile, '<op>', …args)`
  // marker in front and then runs for real — capture is a full live run. The
  // produced log is parseLog-compatible (typed-row CSV).
  // Process-context normalization: any built-in whose value depends on the running
  // process's IDENTITY must resolve to the ORIGINAL process's value, not the clone's
  // — otherwise the helper's behaviour (and its logged output) diverges from a real
  // run. GetProcessName() is the one such function: the clone is named `<base>_TI`,
  // so an unrewritten call bakes the `_TI` suffix into any view/subset/name derived
  // from it. Substitute it with the original name literal. (The other context
  // built-ins — GetProcessErrorFileDirectory, ServerName, TM1User — are server/
  // session-level and return the SAME value for the clone, so they need no rewrite.)
  const procNameLit = `'${escapeODataKey(processName)}'`;
  // NOTE: blind whole-source substitution — it would also rewrite a literal
  // `GetProcessName()` that appears inside a TI comment (`#…`) or a quoted
  // string. A comment/string-aware pass isn't cheap here: the lexer's
  // findCallSites() yields only top-level calls, whereas GetProcessName() is
  // typically nested inside another call's args (e.g. `ViewCreate(GetProcessName(),…)`),
  // so a safe rewrite would have to recurse into every arg-string. The
  // false-positive (the exact text inside a comment/string) is effectively
  // never seen in real TI, so we accept the blind replace.
  const subProcName = (s: string) => s.replace(/GetProcessName\s*\(\s*\)/gi, procNameLit);
  const r1 = rewriteSource(subProcName(src.prolog), LOG_FILE_VAR);
  const r2 = rewriteSource(subProcName(src.metadata), LOG_FILE_VAR);
  const r3 = rewriteSource(subProcName(src.data), LOG_FILE_VAR);
  const r4 = rewriteSource(subProcName(src.epilog), LOG_FILE_VAR);

  // Inject the logfile-variable declaration at the top of the prolog so all
  // four sections can reference it via `LOG_FILE_VAR` (sLogFile by default).
  // ASCIIOutputOpen(file, 0) truncates the file once at prolog start so
  // subsequent ASCIIOutput calls from all sections append rather than overwrite.
  // Instrument cell/attribute reads AFTER write-rewriting so the __CELLREAD__
  // ASCIIOutput markers this pass emits are not themselves rewritten. This
  // captures reads whose cube/coords are built from variables (unknown to
  // static analysis) so they resolve during simulation.
  const inst = (s: string) => instrumentReads(s, LOG_FILE_VAR);
  const prologBody   = `${LOG_FILE_VAR} = ${logFileLit};\nASCIIOutputOpen(${LOG_FILE_VAR}, 0);\n${inst(r1.rewritten)}`;
  const metadataBody = `${LOG_FILE_VAR} = ${logFileLit};\nASCIIOutputOpen(${LOG_FILE_VAR}, 1);\n${inst(r2.rewritten)}`;
  const dataBody     = `${LOG_FILE_VAR} = ${logFileLit};\nASCIIOutputOpen(${LOG_FILE_VAR}, 1);\n${sourceDumpStmt}\n${inst(r3.rewritten)}`;
  const epilogBody   = `${LOG_FILE_VAR} = ${logFileLit};\nASCIIOutputOpen(${LOG_FILE_VAR}, 1);\n${inst(r4.rewritten)}`;

  const banner = [
    `### TI-Test-Framework TI for ${processName} ###`,
    `### Generated by vscode-tm1-ti. On capture the extension auto-deploys, runs, and imports ###`,
    `### the log for you — no manual steps. Standalone fallback: deploy on TM1, run with the ###`,
    `### test's parameters, then read via ErrorLogFiles('<name>')/Content and save to data/: ###`,
    `### TM1ProcessError_${fileBase}_output.log → data/${fileBase}_log.txt ###`,
    src.variables.length > 0
      ? `### TM1ProcessError_${fileBase}_source.log → data/${fileBase}_source.txt ###`
      : `### (no source variables — no separate _source.log produced) ###`,
  ].join('\n');

  const content =
    banner +
    '\n\n#region prolog\n' +
    prologBody +
    '\n#endregion prolog\n\n' +
    '#region metadata\n' +
    metadataBody +
    '\n#endregion metadata\n\n' +
    '#region data\n' +
    dataBody +
    '\n#endregion data\n\n' +
    '#region epilog\n' +
    epilogBody +
    '\n#endregion epilog\n';

  await fs.writeFile(path.join(helperDir, `${fileBase}.ti`), content, 'utf8');

  await fs.writeFile(
    path.join(helperDir, `${fileBase}.params.txt`),
    params.map((p) => `${p.Name} = ${p.Value}`).join('\n') + '\n',
    'utf8',
  );

  return {
    helperName,
    helperSections: {
      prolog: prologBody,
      metadata: metadataBody,
      data: dataBody,
      epilog: epilogBody,
    },
  };
}

export function buildTestReadme(processName: string, testName: string): string {
  const fileBase = processName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 56);
  return [
    `# TI Test: ${testName}`,
    ``,
    `Process: \`${processName}\``,
    ``,
    `## ⚠ Capture RUNS THE PROCESS LIVE ON TM1`,
    ``,
    `Capturing this test deploys a helper clone and EXECUTES it on the server.`,
    `Consequences — only capture on a TEST/DEV server:`,
    `- **Every cube/dim/attribute write is applied to TM1** — capture is a full`,
    `  live run. The writes are also logged, so the test knows what to expect.`,
    `- **Side effects always happen**: \`ExecuteProcess\`/sub-processes run,`,
    `  \`Sleep\` pauses, \`LogOutput\` writes the message log, datasource + file`,
    `  reads happen, ODBC/external calls fire.`,
    `- \`GetProcessName()\` is rewritten to the ORIGINAL process name so derived`,
    `  view/subset names match a real run (the clone's \`_TI\` suffix is hidden).`,
    ``,
    `## What this folder contains`,
    ``,
    `\`\`\``,
    `manifest.json`,
    `README.md                   ← this file`,
    `data/`,
    `  process.ti                ← TI source fetched from the server (#region markers)`,
    `  parameters.json           ← parameter values (you edit if needed)`,
    `  source.csv                ← STUB — replace with TI export (step 3a)`,
    `  output.csv                ← STUB — replace with TI export (step 3b)`,
    `  variables.json / cube-dims.json / dim-fixtures.json`,
    `  cube-fixtures.jsonl / dim-attributes.json`,
    `TI/`,
    `  ${fileBase}.ti            ← deploy this on TM1 (step 1)`,
    `  ${fileBase}.params.txt    ← parameter cheat sheet for the run`,
    `\`\`\``,
    ``,
    `## How the test is populated`,
    ``,
    `On capture the extension does this for you automatically: it deploys the`,
    `helper \`${fileBase}_TI\`, runs it with your parameters, then reads its output`,
    `back via \`ErrorLogFiles('<name>')/Content\` and drops it into \`data/\`. No`,
    `manual steps — just Simulate.`,
    ``,
    `### Standalone fallback (if auto-import failed)`,
    ``,
    `1. Deploy \`TI/${fileBase}.ti\` on TM1 as process \`${fileBase}_TI\` (match the`,
    `   original \`${processName}\` Datasource — same View/Subset/ASCII source).`,
    `2. Run it with the values from \`TI/${fileBase}.params.txt\`. It writes to the`,
    `   TM1 logging dir (\`GetProcessErrorFileDirectory()\`), using a`,
    `   \`TM1ProcessError_*.log\` name so REST can read it back:`,
    `   - \`TM1ProcessError_${fileBase}_output.log\` — one CSV row per Cell-write:`,
    `     \`cube,e1,…,eN,value\` (already in the format the simulator expects).`,
    `   - \`TM1ProcessError_${fileBase}_source.log\` — one CSV row per Data-section`,
    `     iteration: \`vdim_1,…,vdim_N\` (only when the process has a datasource).`,
    `3. Save into the workspace (strip the prefix + \`.log\`, drop any leading BOM):`,
    `   - \`TM1ProcessError_${fileBase}_output.log\` → \`data/${fileBase}_log.txt\``,
    `   - \`TM1ProcessError_${fileBase}_source.log\` → \`data/${fileBase}_source.txt\``,
    ``,
    `### Run the simulator`,
    ``,
    `Right-click this test in the **TI Tests** sidebar → **Simulate (Client-side)**.`,
    `The simulator parses \`data/process.ti\`, iterates \`data/${fileBase}_source.txt\``,
    `row by row binding \`vdim_*\`, collects all CellPutN/S/IncrementN calls, and`,
    `diffs the result against \`data/${fileBase}_log.txt\`. Pass → toast. Fail →`,
    `Diff-Webview with per-cell expected/actual side-by-side.`,
    ``,
    `## Updating the test`,
    ``,
    `- Replace \`data/process.ti\` with a new TI version → re-run Simulate to`,
    `  verify the new code produces the same writes.`,
    `- Replace \`data/source.csv\` with different rows to test edge cases without`,
    `  re-running the original on TM1.`,
    `- Toggle \`active: false\` in \`manifest.json\` to skip during folder runs.`,
    ``,
  ].join('\n');
}
