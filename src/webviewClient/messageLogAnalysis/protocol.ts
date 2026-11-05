// src/webviewClient/messageLogAnalysis/protocol.ts
//
// Messages between the Process Run Analysis window and its host
// (commands/messageLogAnalysis.ts). The node/stat shapes are the subset of
// messageLog/messageLogAnalysisPure.ts the window reads, restated here so the
// bundle carries no analyzer code. The host posts the real AnalysisResult
// through HostToWebview, so a drift fails tsc there.

export type CallStatusView = 'ok' | 'error' | 'running' | 'orphan' | 'group';

export interface CallNodeView {
  name: string;
  kind: 'process' | 'chore';
  startTs: string;
  endTs?: string;
  asyncAttached?: boolean;
  elapsedSec: number | null;
  selfSec: number | null;
  selfPct: number | null;
  status: CallStatusView;
  truncated: boolean;
  ambiguous: boolean;
  inconsistent: boolean;
  errorFile?: string;
  errorText?: string;
  children: CallNodeView[];
}

export interface ProcStatView {
  name: string;
  calls: number;
  totalSec: number;
  avgSec: number;
  minSec: number;
  maxSec: number;
  failures: number;
  uncertain: number;
  uncertainSec: number;
}

export interface AnalysisResultView {
  trees: CallNodeView[];
  stats: ProcStatView[];
  parsedRuns: number;
  ignoredLines: number;
  entryCount: number;
}

export type WebviewToHost =
  | { command: 'setDepth'; depth: number }
  | { command: 'setHideControl'; hide: boolean }
  | { command: 'refresh' }
  | { command: 'openErrorLog'; file: string };

/** One field set per update. */
export interface HostToWebview {
  result?: AnalysisResultView;
  error?: string;
  langHint?: string;
}

/** window.__mlaL: localized texts from the host. */
export type MlaTexts = {
  running: string; proc: string; calls: string; fail: string; entries: string;
  runs: string; ignored: string; uncertain: string; ambigTip: string;
  uncExcluded: string; truncTip: string; incTip: string; choreTip: string;
  asyncRuns: string; asyncTip: string; shortHidden: string; errorLog: string;
};
