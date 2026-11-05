import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import {
  deployClone,
  executeClone,
  deleteClone,
} from '../../tiTestFramework/rest/cloneProcessApi';
import { deleteErrorLog, readErrorLog } from '../../tiTestFramework/rest/fileApi';
import { buildCubeFixturesJsonl, buildAttrReadsJsonl, extractRuleReads, ruleLengthMatches } from '../../tiTestFramework/log/logParser';
import { getCubeRules } from '../../tm1Rest/cubeApi';
import { resolveRootFolder } from '../../views/tiTestTreeProvider';
import { logBestEffort } from '../../providers/bestEffortLog';
import { errMsg } from '../../utils/errMsg';
import { fetchProcessForCapture, scanSubProcessCalls } from './helpers';
import { promptForTestName } from './prompt';
import { showServerParameterForm } from '../processEditor/processParams';
import { writeSimulatorTestSkeleton } from './skeleton';
import type {
  CommandDeps,
  HelperRunResult,
  ProcessFetchResult,
} from './types';

type ActiveConfig = NonNullable<ReturnType<CommandDeps['getActiveConfig']>>;

type CapturePrep = {
  active: ActiveConfig;
  rootFolder: string;
  parentAbs: string;
  testFolder: string;
  testName: string;
  processName: string;
  processSrc: ProcessFetchResult;
  params: { Name: string; Value: string | number }[];
};

export async function captureProcess(
  deps: CommandDeps,
  processName: string,
  serverId?: string,
): Promise<void> {
  const prep = await _prepareCapture(deps, processName, serverId);
  if (!prep) return;

  await _runPhase1Capture(deps, prep);
}

/**
 * Resolve server, root folder, test target folder + name, fetch process,
 * warn on sub-process calls (they run live on TM1 and are NOT logged), prompt
 * parameters. Returns null on any user-cancel or recoverable error (after
 * showing a user-facing message).
 */
async function _prepareCapture(
  deps: CommandDeps,
  processName: string,
  serverId: string | undefined,
): Promise<CapturePrep | null> {
  const active = serverId ? deps.getConfigByServerId(serverId) : deps.getActiveConfig();
  if (!active) {
    vscode.window.showErrorMessage(vscode.l10n.t('Connect to a TM1 server before capturing tests.'));
    return null;
  }

  const rootFolder = resolveRootFolder();
  if (!rootFolder) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Open a workspace folder before capturing tests (configurable via tm1.tests.rootFolder).'),
    );
    return null;
  }

  const { pickFolderForCapture } = await import('./tiTestFolder');
  const parentAbs = await pickFolderForCapture(rootFolder, () => { void deps.treeProvider.refresh(); });
  if (!parentAbs) return null;

  const testName = await promptForTestName(parentAbs, processName);
  if (!testName) return null;

  const testFolder = path.join(parentAbs, testName.trim());

  let processSrc: ProcessFetchResult;
  try {
    processSrc = await fetchProcessForCapture(active.cfg, processName);
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not fetch process: {0}', (e as Error).message));
    return null;
  }

  // Capture is a full live run (decided 2026-10-20, "that is how it is sold"):
  // the helper logs every write and then runs it, sub-processes included.
  // One warning, with the sub-process calls listed when there are any.
  const subProcessRefs = scanSubProcessCalls(processSrc);
  const subList = subProcessRefs.map((r) => `• ${r.section}:${r.line}  ${r.call}`).join('\n');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      "Capture runs a helper copy of process '{0}' live on server '{1}'. Every write happens for real (cells, elements, attributes, views, subsets, rules, security, SaveDataAll), and sub-processes run too. Only proceed on a test/dev server.",
      processName,
      active.serverName,
    ),
    {
      modal: true,
      detail: subProcessRefs.length > 0
        ? vscode.l10n.t('Sub-process calls run live and are not captured:\n{0}', subList)
        : undefined,
    },
    vscode.l10n.t('Continue'),
  );
  if (choice !== vscode.l10n.t('Continue')) return null;

  // The same form as Run and Debug from the tree, with the last values per process.
  const params = await showServerParameterForm(
    processName,
    processSrc.parameters.map((p) => ({ Name: p.Name, Type: p.Type, Value: p.Value ?? '', Prompt: p.Prompt ?? '' })),
    vscode.l10n.t('Capture'),
    active.cfg.serverUrl,
  );
  if (!params) return null;

  return {
    active,
    rootFolder,
    parentAbs,
    testFolder,
    testName,
    processName,
    processSrc,
    params,
  };
}

/** Basename the helper uses for the files it writes to the TM1 ProcessError dir. */
function helperFileBase(processName: string): string {
  return processName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 56);
}

/**
 * After the helper ran on TM1, pull the op-log (and, if the process has a
 * datasource, the source-row dump) it wrote to `GetProcessErrorFileDirectory()`
 * straight into the test's `data/` folder — so the user never copies files by
 * hand. The helper writes them as `TM1ProcessError_<base>_{log,source}.log` (the
 * only names REST can read back via `ErrorLogFiles('<name>')/Content`); we strip
 * that prefix + `.log` and write plain `<base>_log.txt` / `<base>_source.txt`
 * into `data/`, matching what the expected-resolver (`*_log.txt`) and
 * `pickSourceFile` (`*_source.(txt|dat)`) already glob. The leading UTF-8 BOM
 * that `ASCIIOutput` emits is stripped. Best-effort: returns the LOCAL basenames
 * that landed; a miss (name not resolvable, or file absent) leaves the caller to
 * fall back to manual-copy guidance. A server file that was read is deleted
 * afterwards (on v12 it would otherwise sit in the user-visible `Files` space).
 * `io` is injectable for tests.
 */
export async function importHelperOutputs(
  cfg: Tm1Config,
  dataDir: string,
  fileBase: string,
  hasSourceVars: boolean,
  io: {
    read: (cfg: Tm1Config, fileName: string) => Promise<{ found: boolean; content: string }>;
    write: (filePath: string, content: string) => Promise<void>;
    remove?: (cfg: Tm1Config, fileName: string) => Promise<void>;
  } = { read: readErrorLog, write: (p, c) => fs.writeFile(p, c, 'utf8'), remove: deleteErrorLog },
): Promise<string[]> {
  const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
  const targets = [{ server: `TM1ProcessError_${fileBase}_output.log`, local: `${fileBase}_log.txt` }];
  if (hasSourceVars) {
    targets.push({ server: `TM1ProcessError_${fileBase}_source.log`, local: `${fileBase}_source.txt` });
  }

  const landed: string[] = [];
  for (const { server, local } of targets) {
    const r = await io.read(cfg, server);
    // Import when the file EXISTS, even if empty: a process that logs no writes
    // (e.g. pure computation, or a datasource-less helper) produces an empty
    // `ASCIIOutputOpen`-created log. That's a valid "no writes" baseline — a
    // Simulate against it matches cleanly. Only a genuinely absent file (404 →
    // found:false) falls through to the manual-copy guidance.
    if (r.found) {
      // Only count as landed when the LOCAL write actually succeeded. A failed
      // fs write (disk full / permission / lock) must NOT be reported as imported
      // — otherwise the caller shows a success toast for a file that never hit
      // disk and the manual-copy fallback never fires.
      try {
        await io.write(path.join(dataDir, local), stripBom(r.content));
        landed.push(local);
        await io.remove?.(cfg, server);
      } catch {
        // swallow: leave `local` out of `landed` so the caller routes to the
        // manual-copy fallback warning for this file.
      }
    }
  }
  return landed;
}

/** Phase-1 single-process capture: write skeleton, deploy + run helper, auto-import logs. */
async function _runPhase1Capture(deps: CommandDeps, prep: CapturePrep): Promise<void> {
  const { active, rootFolder, testFolder, testName, processName, processSrc, params } = prep;

  let helperResult: HelperRunResult | undefined;
  try {
    helperResult = await writeSimulatorTestSkeleton({
      testFolder,
      testName,
      processName,
      processSrc,
      params,
      serverName: active.serverName,
      extensionVersion: deps.extensionVersion,
      cfg: active.cfg,
    });
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Skeleton write failed: {0}', (e as Error).message));
    return;
  }

  const fileBase = helperFileBase(processName);
  const dataDir = path.join(testFolder, 'data');
  let landed: string[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying + running helper for ${processName}`,
    },
    async () => {
      // The clone carries a copy of the TI code, its parameters and the original
      // DataSource — with ODBC that includes credentials. It must not survive a
      // failure, so deletion happens in `finally` and not only on the paths that
      // reach the end. `keepCloneOnError` applies to a real process error, not to
      // a transport or import failure: those say nothing about the process.
      let deployed = false;
      let keepClone = false;
      try {
        await deployClone(active.cfg, {
          name: helperResult!.helperName,
          prolog: helperResult!.helperSections.prolog,
          metadata: helperResult!.helperSections.metadata,
          data: helperResult!.helperSections.data,
          epilog: helperResult!.helperSections.epilog,
          dataSource:
            (processSrc.datasource as { Type: string; [k: string]: unknown }) ?? { Type: 'None' },
          parameters: processSrc.parameters,
          variables: processSrc.variables,
        });
        deployed = true;
        const exec = await executeClone(
          active.cfg,
          helperResult!.helperName,
          params.map((p) => ({ Name: p.Name, Value: p.Value })),
        );
        // Pull the helper's output files regardless of soft status — the op-log
        // is useful even on minorErrors.
        landed = await importHelperOutputs(
          active.cfg,
          dataDir,
          fileBase,
          processSrc.variables.length > 0,
        );
        // Split runtime read-captures (__CELLREAD__ markers) out of the op-log
        // into a cube-cell fixture, so reads whose cube/coords are built from
        // variables resolve during simulation. Best-effort — no log or no
        // captures simply yields no fixture file.
        if (landed.includes(`${fileBase}_log.txt`)) {
          try {
            const logText = await fs.readFile(path.join(dataDir, `${fileBase}_log.txt`), 'utf8');
            const { jsonl, droppedCount, conflictCount } = buildCubeFixturesJsonl(logText);
            if (jsonl) {
              await fs.writeFile(path.join(dataDir, 'cube-fixtures.jsonl'), jsonl, 'utf8');
            }
            // Split runtime attribute-read captures (__ATTRREAD__ markers) out of
            // the op-log into a separate attr fixture, so object-level attribute
            // reads whose object/attr are built from variables resolve during
            // simulation. Same best-effort/dropped-numeric handling as cells.
            const attr = buildAttrReadsJsonl(logText);
            // CubeRuleGet: the log only holds cube + length; fetch the text now
            // and keep it only if it is still the text the process read.
            let ruleRows = '';
            let ruleMismatch = 0;
            let ruleFetchFailed = 0;
            const ruleReads = extractRuleReads(logText);
            const ruleTexts = await Promise.all(
              ruleReads.map((r) => getCubeRules(active.cfg, r.cube).catch(() => undefined)),
            );
            for (const [i, r] of ruleReads.entries()) {
              const text = ruleTexts[i];
              if (text === undefined && r.length === 0) {
                ruleRows += JSON.stringify({ fn: 'cuberuleget', args: [r.cube], value: '' }) + '\n';
              } else if (text === undefined) {
                ruleFetchFailed++;
              } else if (ruleLengthMatches(text, r.length)) {
                ruleRows += JSON.stringify({ fn: 'cuberuleget', args: [r.cube], value: text }) + '\n';
              } else {
                ruleMismatch++;
              }
            }
            if (attr.jsonl || ruleRows) {
              await fs.writeFile(path.join(dataDir, 'attr-reads.jsonl'), attr.jsonl + ruleRows, 'utf8');
            }
            if (ruleFetchFailed > 0) {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  '{0} cube rule text(s) could not be fetched after the run — Simulate reads those rules as empty.',
                  ruleFetchFailed,
                ),
              );
            }
            if (ruleMismatch > 0) {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  '{0} cube rule read(s) changed between the run and the readback — Simulate reads those rules as empty.',
                  ruleMismatch,
                ),
              );
            }
            if (attr.droppedCount > 0) {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  '{0} ambiguous numeric attribute read(s) dropped from attr-reads — Simulate reads those as 0 or empty. Check the server number locale if this is unexpected.',
                  attr.droppedCount,
                ),
              );
            }
            // Ambiguous numeric reads (value with both '.' and ',') were dropped
            // rather than written as a wrong `0` fixture cell — the capture is
            // imperfect, so tell the user which cells Simulate will read as
            // 0/empty instead of silently getting a wrong value.
            if (droppedCount > 0) {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  '{0} ambiguous numeric cell read(s) dropped from cube-fixtures — Simulate reads those cells as 0 or empty. Check the server number locale if this is unexpected.',
                  droppedCount,
                ),
              );
            }
            // A coordinate read more than once with a CHANGING value (external
            // write, rule recompute, or the process's own earlier write) only keeps its LAST value after dedup — a replay
            // reading it at an earlier call site silently gets the later value.
            if (conflictCount > 0) {
              vscode.window.showWarningMessage(
                vscode.l10n.t(
                  '{0} cell coordinate(s) were read with changing values during capture; only the last value is stored in cube-fixtures. Reads of those cells at earlier points may not match.',
                  conflictCount,
                ),
              );
            }
          } catch {
            /* read-capture fixture is optional */
          }
        }
        if (exec.status !== 'success') {
          keepClone = vscode.workspace
            .getConfiguration('tm1.tests')
            .get<boolean>('keepCloneOnError', true);
          vscode.window.showWarningMessage(
            keepClone
              ? vscode.l10n.t('Helper finished with status {0}. Helper process kept on TM1 for inspection. ErrorLog: {1}', exec.status, (exec.errorLogContent || '').slice(0, 200))
              : vscode.l10n.t('Helper finished with status {0}. ErrorLog: {1}', exec.status, (exec.errorLogContent || '').slice(0, 200)),
          );
        }
      } catch (e) {
        vscode.window.showErrorMessage(vscode.l10n.t('Helper deploy/run failed: {0}', (e as Error).message));
      } finally {
        if (deployed && !keepClone) {
          try {
            await deleteClone(active.cfg, helperResult!.helperName);
          } catch (e) {
            // Silently leaving it behind is the worse outcome: the clone stays
            // runnable on the server and may hold DataSource credentials.
            vscode.window.showWarningMessage(
              vscode.l10n.t(
                'TM1: helper process "{0}" could not be removed and is still on the server: {1}',
                helperResult!.helperName, errMsg(e),
              ),
            );
          }
        }
      }
    },
  );

  deps.treeProvider.refresh().catch(e => logBestEffort('TiTest', 'refresh tests tree', e));
  const rel = path.relative(rootFolder, testFolder);
  const openFolder = (choice: string | undefined) => {
    if (choice === vscode.l10n.t('Open folder')) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(testFolder));
    }
  };

  if (landed.includes(`${fileBase}_log.txt`)) {
    vscode.window
      .showInformationMessage(
        vscode.l10n.t(
          'TI test "{0}" captured — outputs imported from TM1 ({1}). Right-click → Simulate.',
          rel,
          landed.join(', '),
        ),
        vscode.l10n.t('Open folder'),
      )
      .then(openFolder);
  } else {
    // Auto-import missed (server rejected the ErrorLogs key, or the helper wrote
    // nothing). Fall back to manual copy — same filenames into data/.
    vscode.window
      .showWarningMessage(
        vscode.l10n.t(
          "Test ready: {0}. TI ran on TM1 but logs could not be auto-imported. Read via ErrorLogFiles('<name>')/Content and save:  TM1ProcessError_{1}_output.log → data/{1}_log.txt  •  TM1ProcessError_{1}_source.log → data/{1}_source.txt  — then right-click → Simulate.",
          rel,
          fileBase,
        ),
        vscode.l10n.t('Open folder'),
      )
      .then(openFolder);
  }
}
