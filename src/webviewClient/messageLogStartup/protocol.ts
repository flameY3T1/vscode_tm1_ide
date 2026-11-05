// src/webviewClient/messageLogStartup/protocol.ts
//
// Messages between the Server Startup Analysis window and its host
// (commands/messageLogStartup.ts). The data shapes are the subset of
// commands/messageLogStartupPure.ts the window reads; they are restated here
// because webviewClient/ must not import commands/. The host posts the real
// types through HostToWebview, so a drift fails tsc there.

export interface StartupRefView {
  readyTs: string;
  elapsedSec: number;
  beginTs: string | null;
  prevEnd: 'clean' | 'unlogged' | 'unknown';
  prevEndTs: string | null;
  downSec: number | null;
  abortedBefore: number;
}

export interface CubeLoadView {
  name: string;
  thread: number | undefined;
  startTs: string;
  endTs: string;
  sec: number;
}

export interface WorkerLaneView {
  thread: number | undefined;
  cubes: CubeLoadView[];
  busySec: number;
  spanSec: number;
}

export interface StartupAnalysisView {
  reportedSec: number | null;
  loadTimeSec: number | null;
  wallSec: number | null;
  mtqThreads: number | null;
  cubeLoadThreads: number | null;
  cubes: CubeLoadView[];
  lanes: WorkerLaneView[];
  maxParallel: number;
  busySec: number;
  coveredSec: number;
  criticalLaneSec: number;
  criticalThread: number | undefined;
  headers: number;
  dimensions: number;
  rules: number;
  feeders: { name: string; sec: number }[];
  feedersFromFile: number;
  preludeSec: number | null;
  tailSec: number | null;
  unpairedStarts: number;
  unpairedEnds: number;
  lineCount: number;
}

export type WebviewToHost =
  | { command: 'select'; readyTs: string }
  | { command: 'reload' };

export interface HostToWebview {
  startups?: StartupRefView[];
  /** Oldest readable log line; sent together with `startups`. */
  coverageFrom?: string | null;
  analysis?: StartupAnalysisView | null;
  status?: string;
  error?: string;
  langHint?: string;
}

/** window.__mls: localized texts from the host, so the window has no second source. */
export interface MlsBootstrap {
  texts: {
    noStartups: string; pick: string; reported: string; wall: string; loadTime: string;
    workers: string; parallel: string; mtq: string; feeders: string; computed: string;
    fromFile: string; floor: string; floorSub: string; budget: string; prelude: string;
    bodies: string; tail: string; rest: string; work: string; lanes: string; lane: string;
    cubesTbl: string; cube: string; dur: string; share: string; feedersTbl: string;
    counted: string; headers: string; dims: string; rules: string; lines: string;
    sumNote: string; clipped: string; floorNote: string;
    trend: string; endClean: string; endUnlogged: string; endUnknown: string;
    down: string; downMax: string; aborted: string; coverage: string; unloggedNote: string;
  };
}
