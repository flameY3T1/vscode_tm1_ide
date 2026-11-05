import * as vscode from 'vscode';
import * as path from 'node:path';
import type { TiTestTreeItem } from '../../views/tiTestTreeProvider';
import type { SummaryHandlers } from '../../webviews/tiTestSummaryWebview';
import type { SummaryRow } from '../../webviews/renderSummaryHtml';
import { simulateOne } from './simulateOne';
import { emptyDiffSummary } from './mode';
import { filterMeaningfulWarnings } from './simulateBatchPure';
import type { SimulateDeps } from './simulateTypes';

export async function simulateTest(deps: SimulateDeps, testFolder: string): Promise<void> {
  // Same notification as a folder run: a large test blocks the extension host
  // for tens of seconds (30 s on a 1.8M-row production test), and without it
  // nothing showed that a run was going on.
  const out = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Simulating {0} test(s) — {1}', 1, path.basename(testFolder)),
    },
    () => simulateOne(deps, testFolder),
  );

  if (out.row.error) {
    vscode.window.showErrorMessage(out.row.error);
    return;
  }
  const meaningfulWarnings = filterMeaningfulWarnings(out.warnings);
  if (meaningfulWarnings.length > 0) {
    const sample = meaningfulWarnings.slice(0, 3).join(' · ');
    vscode.window.showWarningMessage(vscode.l10n.t('Simulator: {0} warning(s) — {1}', meaningfulWarnings.length, sample));
  }
  if (out.parseErrors.length > 0) {
    const sample = out.parseErrors.slice(0, 3).join(' · ');
    vscode.window.showWarningMessage(vscode.l10n.t('Parse errors: {0} — {1}', out.parseErrors.length, sample));
  }

  if (!out.manifest || !out.diffResult) return;
  // Sub-mode: always show diff view (user explicitly drilled into one sub
  // and wants to see its result regardless of pass/fail).
  const isSubMode = 'kind' in out.manifest && out.manifest.kind === 'ti-test-sub';
  if (out.row.pass && !isSubMode) {
    deps.diffView.updateIfOpen(testFolder, out.manifest, out.diffResult, out.row.summary, out.cubeDims ?? {});
    vscode.window.showInformationMessage(
      out.row.summary.totalDiffs === 0
        ? vscode.l10n.t('{0}: PASS (no diffs)', out.manifest.name)
        : vscode.l10n.t('{0}: PASS ({1} diffs)', out.manifest.name, out.row.summary.totalDiffs),
    );
  } else {
    deps.diffView.show(testFolder, out.manifest, out.diffResult, out.row.summary, out.cubeDims ?? {});
  }
}

/**
 * Show the same summary view that appears after running a folder, but built
 * from persisted run-state without re-running tests. For each active test
 * descendant: pass/fail row from .last-run.json, or `never run` placeholder.
 */
export async function showFolderSummary(deps: SimulateDeps, item?: TiTestTreeItem): Promise<void> {
  const tests = deps.treeProvider.collectTestsBelow(item).filter((t) => t.manifest.active);
  if (tests.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('No active tests in selection.'));
    return;
  }

  const folderLabel = item ? item.label?.toString() ?? 'tests' : 'all tests';
  const folderKey = item ? item.id ?? folderLabel : 'root';

  const rows: SummaryRow[] = tests.map((t) => {
    const state = deps.treeProvider.getRunState(t.folder);
    const lastRun = state?.lastRun;
    if (!lastRun) {
      return {
        testFolder: t.folder,
        testName: t.manifest.name,
        pass: false,
        summary: emptyDiffSummary(),
        durationMs: 0,
        error: 'never run',
      };
    }
    return {
      testFolder: t.folder,
      testName: t.manifest.name,
      pass: lastRun.result === 'pass',
      summary: emptyDiffSummary(),
      durationMs: 0,
    };
  });

  const handlers: SummaryHandlers = {
    onShowDiff: (folder) => {
      const entry = deps.lastRun.get(folder);
      if (entry) deps.diffView.show(folder, entry.manifest, entry.diff, entry.summary, {});
    },
    onRerunAll: () => simulateFolder(deps, item),
    onRerunFailed: async () => {
      const failed = rows.filter((r) => r.error || !r.pass).map((r) => r.testFolder);
      for (const f of failed) {
        const out = await simulateOne(deps, f);
        const idx = rows.findIndex((r) => r.testFolder === f);
        if (idx >= 0) rows[idx] = out.row;
      }
      deps.summaryView.show(folderKey, folderLabel, rows, handlers);
    },
  };
  deps.summaryView.show(folderKey, folderLabel, rows, handlers);
}

export async function simulateFolder(deps: SimulateDeps, item?: TiTestTreeItem): Promise<void> {
  const tests = deps.treeProvider.collectTestsBelow(item).filter((t) => t.manifest.active);
  if (tests.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('No active tests in selection.'));
    return;
  }

  const folderLabel = item ? item.label?.toString() ?? 'tests' : 'all tests';
  const folderKey = item ? item.id ?? folderLabel : 'root';

  const rows: SummaryRow[] = [];
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Simulating {0} test(s) — {1}', tests.length, folderLabel),
      cancellable: true,
    },
    async (progress, token) => {
      let i = 0;
      for (const t of tests) {
        if (token.isCancellationRequested) break;
        i++;
        progress.report({
          message: `${i}/${tests.length} · ${t.manifest.name}`,
          increment: 100 / tests.length,
        });
        const out = await simulateOne(deps, t.folder);
        rows.push(out.row);
      }
    },
  );

  const handlers: SummaryHandlers = {
    onShowDiff: (folder) => {
      const entry = deps.lastRun.get(folder);
      if (entry) deps.diffView.show(folder, entry.manifest, entry.diff, entry.summary, {});
    },
    onRerunAll: () => simulateFolder(deps, item),
    onRerunFailed: async () => {
      const failed = rows.filter((r) => r.error || !r.pass).map((r) => r.testFolder);
      for (const f of failed) {
        const out = await simulateOne(deps, f);
        const idx = rows.findIndex((r) => r.testFolder === f);
        if (idx >= 0) rows[idx] = out.row;
      }
      deps.summaryView.show(folderKey, folderLabel, rows, handlers);
    },
  };
  deps.summaryView.show(folderKey, folderLabel, rows, handlers);
}
