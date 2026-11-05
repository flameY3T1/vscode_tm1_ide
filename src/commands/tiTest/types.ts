import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { Manifest } from '../../tiTestFramework/storage/manifestIo';
import type { DiffResult, DiffSummary } from '../../tiTestFramework/diff/diffResult';
import type { TiTestTreeProvider } from '../../views/tiTestTreeProvider';
import type { TiTestDiffWebviewManager } from '../../webviews/tiTestDiffWebview';
import type { TiTestSummaryWebviewManager } from '../../webviews/tiTestSummaryWebview';

export type LastRunEntry = {
  manifest: Manifest;
  diff: DiffResult;
  summary: DiffSummary;
};

/** In-memory cache of the most recent diff/summary per test folder. Lives in
 *  the singleton TI-Test command registry; cleared on test deletion. */
export class LastRunCache {
  private readonly _cache = new Map<string, LastRunEntry>();
  set(folder: string, entry: LastRunEntry): void {
    this._cache.set(folder, entry);
  }
  get(folder: string): LastRunEntry | undefined {
    return this._cache.get(folder);
  }
  delete(folder: string): void {
    this._cache.delete(folder);
  }
}

export type CommandDeps = {
  context: vscode.ExtensionContext;
  treeProvider: TiTestTreeProvider;
  diffView: TiTestDiffWebviewManager;
  summaryView: TiTestSummaryWebviewManager;
  lastRun: LastRunCache;
  getActiveConfig: () => { cfg: Tm1Config; serverName: string } | undefined;
  /** Resolve a Tm1Config + server-name from a tree-node's serverId. */
  getConfigByServerId: (serverId: string) => { cfg: Tm1Config; serverName: string } | undefined;
  extensionVersion: string;
};

export type ProcessFetchResult = {
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
  parameters: { Name: string; Type: 'Numeric' | 'String'; Value?: string | number; Prompt?: string }[];
  datasource: { Type: string; [k: string]: unknown };
  variables: {
    Name: string;
    Type: 'Numeric' | 'String';
    Position: number;
    StartByte: number;
    EndByte: number;
  }[];
};

export type HelperRunResult = {
  helperName: string;
  helperSections: { prolog: string; metadata: string; data: string; epilog: string };
};

export type WriteSkeletonInput = {
  testFolder: string;
  testName: string;
  processName: string;
  processSrc: ProcessFetchResult;
  params: { Name: string; Value: string | number }[];
  serverName: string;
  extensionVersion: string;
  /** TM1 config so we can fetch Dimensions for each detected target cube. */
  cfg?: Tm1Config;
};
