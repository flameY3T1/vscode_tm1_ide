import type { TiTestTreeProvider } from '../../views/tiTestTreeProvider';
import type { TiTestDiffWebviewManager } from '../../webviews/tiTestDiffWebview';
import type { TiTestSummaryWebviewManager } from '../../webviews/tiTestSummaryWebview';
import type { SummaryRow } from '../../webviews/renderSummaryHtml';
import type { DiffResult } from '../../tiTestFramework/diff/diffResult';
import type { readManifest } from '../../tiTestFramework/storage/manifestIo';
import type { LastRunCache } from './types';

export type SimulateDeps = {
  treeProvider: TiTestTreeProvider;
  diffView: TiTestDiffWebviewManager;
  summaryView: TiTestSummaryWebviewManager;
  lastRun: LastRunCache;
  floatTolerance: () => number;
  /** Entries kept per diff kind (`tm1.tests.maxDiffRows`); the rest is only counted. */
  maxDiffRows: () => number;
};

export type SimulateOneOutcome = {
  row: SummaryRow;
  manifest?: Awaited<ReturnType<typeof readManifest>>;
  diffResult?: DiffResult;
  cubeDims?: Record<string, string[]>;
  warnings: string[];
  parseErrors: string[];
};
