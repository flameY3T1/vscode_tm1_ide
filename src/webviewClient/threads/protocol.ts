// src/webviewClient/threads/protocol.ts
//
// Messages between the threads/jobs window and its host (commands/threads.ts).
// The shapes restate the parts of commands/lockChainPure.ts and threadsPure.ts
// the window reads (webviewClient/ may not import commands/); the host posts
// the real types through HostToWebview, so a drift fails tsc there.

export type WaitIdView = string | number;

export interface WaitNodeView {
  id: WaitIdView;
  name: string;
  function?: string;
  objectName?: string;
  waitTimeSec: number;
}

export interface BlockerGroupView {
  blockerId: WaitIdView;
  blocker?: WaitNodeView;
  blocked: WaitNodeView[];
  hasCycle: boolean;
}

export interface ThreadRowView {
  ID?: number;
  JobId?: string;
  Session?: string | number;
  Name?: string;
  Context?: string;
  State?: string;
  Function?: string;
  ObjectName?: string;
  Info?: string;
  TypeLabel: string;
  StateClass: string;
  Elapsed: string;
}

export interface BlockerView {
  id: string | number;
  label: string;
  waiterCount: number;
  fromCycle: boolean;
}

/** One full snapshot per refresh. */
export interface HostToWebview {
  groups: BlockerGroupView[];
  cycleIds: WaitIdView[];
  threads: ThreadRowView[];
  waitingCount: number;
  blockers: BlockerView[];
  error?: string;
  ts: number;
}

export type WebviewToHost =
  | { command: 'setPaused'; paused: boolean }
  | { command: 'manualRefresh' }
  | { command: 'kill'; threadId?: number; jobId?: string }
  | { command: 'killBlockers' }
  | { command: 'killAllWaiting' };

/** window.__l10n of this window. */
export interface ThreadsTexts {
  items: string; pause: string; resume: string; paused: string; noWaitingThreads: string;
  unknown: string; blocks: string; kill: string; killBlockers: string; waiting: string;
}
