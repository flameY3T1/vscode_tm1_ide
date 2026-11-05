import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { listProcesses as listProcessesApi } from '../../tm1Rest/processApi';
import { parseLog } from '../../tiTestFramework/log/logParser';
import { runWithAbortSignal } from '../../tm1Rest/transport/abortScope';
import {
  isRootManifest,
  writeManifest,
  type Manifest,
} from '../../tiTestFramework/storage/manifestIo';
import { resolveRootFolder, type TiTestTreeItem } from '../../views/tiTestTreeProvider';
import { isContainedIn } from '../../utils/pathContainment';
import { logBestEffort } from '../../providers/bestEffortLog';
import {
  buildFixtureBundle,
  fetchProcessForCapture,
  fileExists,
  pickConnectedServer,
} from './helpers';
import type { CommandDeps, ProcessFetchResult } from './types';

export function showDiff(deps: CommandDeps, testFolder: string): void {
  const entry = deps.lastRun.get(testFolder);
  if (!entry) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('No run results yet for {0}. Run the test first.', path.basename(testFolder)),
    );
    return;
  }
  deps.diffView.show(testFolder, entry.manifest, entry.diff, entry.summary);
}

/**
 * Is the delete candidate really inside the test tree?
 *
 * `tm1.tests.rootFolder` carries no `scope`, so it's window-wide and can come
 * from the `.vscode/settings.json` of a foreign workspace; on top of that, an
 * absolute value is taken over unchanged, and a relative one may contain
 * `..`. Also, a symlink INSIDE the tree can point outside. The confirmation
 * dialog doesn't protect against this — it only shows the path it intends to
 * delete anyway.
 *
 * Hence this check: resolve both sides via `realpath` (which defuses the
 * symlink) and check the target against the root. The root ITSELF is not
 * deletable; `isContainedIn` doesn't count equality as contained.
 */
async function refuseOutsideTestRoot(target: string): Promise<string | undefined> {
  const root = resolveRootFolder();
  if (!root) {
    return vscode.l10n.t('No workspace folder is open, so there is no test root to delete from.');
  }
  let realRoot: string;
  let realTarget: string;
  try {
    realRoot = await fs.realpath(root);
    realTarget = await fs.realpath(target);
  } catch (e) {
    return vscode.l10n.t('Could not resolve the path to delete: {0}', (e as Error).message);
  }
  if (!isContainedIn(realRoot, realTarget)) {
    return vscode.l10n.t('Refusing to delete "{0}": it is not inside the test folder "{1}".', realTarget, realRoot);
  }
  return undefined;
}

export async function deleteTestOrFolder(deps: CommandDeps, item?: TiTestTreeItem): Promise<void> {
  if (!item) return;
  const target = item.node.fullPath;
  const outside = await refuseOutsideTestRoot(target);
  if (outside) {
    vscode.window.showErrorMessage(outside);
    return;
  }
  const isFolder = item.node.kind === 'folder';
  const label = item.label?.toString() ?? path.basename(target);
  const detail = isFolder
    ? vscode.l10n.t('Deletes folder + every test underneath:\n{0}', target)
    : vscode.l10n.t('Deletes test folder:\n{0}', target);
  const del = vscode.l10n.t('Delete');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('Delete "{0}"?', label),
    { modal: true, detail },
    del,
  );
  if (choice !== del) return;
  try {
    // maxRetries/retryDelay: under WSL the filesystem layer cleans up with a
    // delay, so a recursive delete then fails with ENOTEMPTY. This matters
    // more here than in a test — the user has confirmed "Delete" and would
    // otherwise get an error message for a folder that's gone a second later.
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    deps.lastRun.delete(target);
    deps.treeProvider.clearLastRun(target);
    deps.treeProvider.refresh().catch(e => logBestEffort('TiTest', 'refresh tests tree', e));
    vscode.window.showInformationMessage(vscode.l10n.t('Deleted: {0}', label));
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not delete: {0}', (e as Error).message));
  }
}

export async function toggleActive(deps: CommandDeps, item?: TiTestTreeItem): Promise<void> {
  if (!item || item.node.kind !== 'test' || !item.node.manifest) return;
  const m: Manifest = { ...item.node.manifest, active: !item.node.manifest.active };
  try {
    await writeManifest(item.node.fullPath, m);
    deps.treeProvider.refresh().catch(e => logBestEffort('TiTest', 'refresh tests tree', e));
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not toggle active: {0}', (e as Error).message));
  }
}

export async function refreshFixtures(deps: CommandDeps, item?: TiTestTreeItem): Promise<void> {
  if (!item || (item.node.kind !== 'test' && item.node.kind !== 'sub')) {
    vscode.window.showInformationMessage(vscode.l10n.t('Right-click a test in the TI Tests sidebar.'));
    return;
  }
  const active = deps.getActiveConfig();
  if (!active) {
    vscode.window.showErrorMessage(vscode.l10n.t('Connect to a TM1 server first.'));
    return;
  }
  // Sub-node click: target the parent test folder for fixture refresh.
  const testFolder = item.node.kind === 'sub'
    ? path.dirname(path.dirname(item.node.fullPath))
    : item.node.fullPath;
  const dataDir = path.join(testFolder, 'data');
  const inputDir = path.join(testFolder, 'input');
  const targetDir = (await fileExists(dataDir)) ? dataDir : inputDir;

  // Collect process.ti + all sub <name>.ti probes.
  const probes: ProcessFetchResult[] = [];
  const rootTi = path.join(targetDir, 'process.ti');
  try {
    const txt = await fs.readFile(rootTi, 'utf8');
    probes.push({ prolog: txt, metadata: '', data: txt, epilog: txt, parameters: [], datasource: { Type: 'None' }, variables: [] });
  } catch {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not read {0}.', rootTi));
    return;
  }
  // Scan data dir for <name>.ti sub files.
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name === 'process.ti' || !e.name.endsWith('.ti')) continue;
      try {
        const txt = await fs.readFile(path.join(targetDir, e.name), 'utf8');
        probes.push({ prolog: txt, metadata: '', data: txt, epilog: txt, parameters: [], datasource: { Type: 'None' }, variables: [] });
      } catch { /* skip unreadable fixture .ti file */ }
    }
  } catch { /* no data dir */ }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Refreshing fixtures (root + subs)…'), cancellable: true },
    async (_progress, token) => {
      // Harvest cubes from captured `__CALL__` markers — bedrock-style helpers
      // receive the cube name via `pCube` parameter, so detectLiteralCubes misses
      // them. Collected here and passed as extraCubes to buildFixtureBundle.
      const extraCubes = new Set<string>();
      try {
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile() || !/_log\.txt$/i.test(e.name)) continue;
          try {
            const text = await fs.readFile(path.join(targetDir, e.name), 'utf8');
            const rows = parseLog(text).rows;
            for (const r of rows) {
              if (r.op !== '__CALL__') continue;
              const callRow = r as { params: Array<[string, string]> };
              for (const [pName, pValue] of callRow.params) {
                if (pName.toLowerCase() === 'pcube' && pValue) extraCubes.add(pValue);
              }
            }
          } catch { /* skip unreadable log */ }
        }
      } catch { /* no data dir entries */ }

      // Cancel aborts the pending GETs; no fixture file is written then, so the
      // old set stays whole instead of half replaced.
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      let bundle: Awaited<ReturnType<typeof buildFixtureBundle>>;
      try {
        bundle = await runWithAbortSignal(abort.signal, () => buildFixtureBundle(active.cfg, probes, [...extraCubes]));
      } catch (e) {
        if (token.isCancellationRequested) { return; }
        throw e;
      }
      if (token.isCancellationRequested) { return; }
      await fs.writeFile(
        path.join(targetDir, 'cube-dims.json'),
        JSON.stringify(bundle.cubeDims, null, 2) + '\n',
        'utf8',
      );
      await fs.writeFile(
        path.join(targetDir, 'dim-fixtures.json'),
        JSON.stringify(bundle.dimFixtures, null, 2) + '\n',
        'utf8',
      );
      if (Object.keys(bundle.dimAttrs).length > 0) {
        await fs.writeFile(
          path.join(targetDir, 'dim-attributes.json'),
          JSON.stringify(bundle.dimAttrs, null, 2) + '\n',
          'utf8',
        );
      }
      const cubeCount = Object.keys(bundle.cubeDims).length;
      const dimCount = Object.keys(bundle.dimFixtures).length;
      const elemCount = Object.values(bundle.dimFixtures).reduce(
        (acc, d) => acc + d.elements.length,
        0,
      );
      const attrDimCount = Object.keys(bundle.dimAttrs).length;
      vscode.window.showInformationMessage(
        vscode.l10n.t('Fixtures refreshed: {0} cube(s), {1} dim(s), {2} element(s), {3} dim(s) with attributes — from {4} process file(s).',
          cubeCount, dimCount, elemCount, attrDimCount, probes.length),
      );
    },
  );
}

export async function replaceTiFromServer(deps: CommandDeps, item?: TiTestTreeItem): Promise<void> {
  if (!item || item.node.kind !== 'test') {
    vscode.window.showInformationMessage(vscode.l10n.t('Right-click a test in the TI Tests sidebar.'));
    return;
  }
  const active = await pickConnectedServer(deps);
  if (!active) return;

  // List all processes on the chosen server.
  let names: string[] = [];
  try {
    const items = await listProcessesApi(active.cfg);
    names = items.map(p => p.Name).sort();
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Could not list processes: {0}', (e as Error).message));
    return;
  }

  const pick = await vscode.window.showQuickPick(names, {
    title: `Replace TI source — pick a process from ${active.serverName}`,
    placeHolder: (item.node.manifest && isRootManifest(item.node.manifest) ? item.node.manifest.process : undefined) ?? 'Select process',
  });
  if (!pick) return;

  let processSrc: ProcessFetchResult;
  try {
    processSrc = await fetchProcessForCapture(active.cfg, pick);
  } catch (e) {
    vscode.window.showErrorMessage(vscode.l10n.t('Fetch process: {0}', (e as Error).message));
    return;
  }

  // Use new data/ layout if present, fall back to legacy input/ for old tests.
  const dataDir = path.join(item.node.fullPath, 'data');
  const legacyInputDir = path.join(item.node.fullPath, 'input');
  let targetDir = dataDir;
  try {
    await fs.access(legacyInputDir);
    // legacy folder exists — only switch to legacy if data/ does NOT exist
    try {
      await fs.access(dataDir);
    } catch {
      targetDir = legacyInputDir;
    }
  } catch {
    /* legacy missing — use data/ */
  }
  const inputDir = targetDir;
  await fs.mkdir(inputDir, { recursive: true });

  const processTi = [
    `#region prolog\n${processSrc.prolog}\n#endregion prolog`,
    `#region metadata\n${processSrc.metadata}\n#endregion metadata`,
    `#region data\n${processSrc.data}\n#endregion data`,
    `#region epilog\n${processSrc.epilog}\n#endregion epilog`,
  ].join('\n\n');
  await fs.writeFile(path.join(inputDir, 'process.ti'), processTi, 'utf8');

  await fs.writeFile(
    path.join(inputDir, 'variables.json'),
    JSON.stringify(
      processSrc.variables.map((v) => ({ Name: v.Name, Type: v.Type })),
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // Refresh cube-dims.json + dim-fixtures.json + dim-attributes.json for the new
  // process — dims come from literal cube targets AND direct dim-read calls.
  const bundle = await buildFixtureBundle(active.cfg, [processSrc]);
  await fs.writeFile(
    path.join(inputDir, 'cube-dims.json'),
    JSON.stringify(bundle.cubeDims, null, 2) + '\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(inputDir, 'dim-fixtures.json'),
    JSON.stringify(bundle.dimFixtures, null, 2) + '\n',
    'utf8',
  );
  if (Object.keys(bundle.dimAttrs).length > 0) {
    await fs.writeFile(
      path.join(inputDir, 'dim-attributes.json'),
      JSON.stringify(bundle.dimAttrs, null, 2) + '\n',
      'utf8',
    );
  }

  // Update manifest.process so the test reflects which process it now runs.
  if (item.node.manifest) {
    const updated: Manifest = { ...item.node.manifest, process: pick };
    try {
      await writeManifest(item.node.fullPath, updated);
    } catch {
      /* manifest write best-effort */
    }
  }

  deps.treeProvider.refresh().catch(e => logBestEffort('TiTest', 'refresh tests tree', e));
  vscode.window.showInformationMessage(
    vscode.l10n.t("Replaced TI in {0} with '{1}'. Right-click → Simulate.", path.basename(item.node.fullPath), pick),
  );
}
