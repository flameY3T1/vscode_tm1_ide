// src/webviewClient/messageLog/protocol.ts
//
// Messages between the Message Log window and its host (commands/messageLog.ts).

/** One row as the host posts it (`mapLogEntry` adds `LevelClass`). */
export interface LogEntryView {
  TimeStamp?: string;
  Timestamp?: string;
  ThreadID?: number | string;
  Level?: string;
  LevelClass?: string;
  Message?: string;
  Text?: string;
  Logger?: string;
}

export type Levels = { info: boolean; warn: boolean; error: boolean; debug: boolean };

export type WebviewToHost =
  | { command: 'setTop'; top: number }
  | { command: 'setLevels'; levels: Levels }
  | { command: 'openErrorLog'; file: string }
  | { command: 'openStartup' }
  | { command: 'openAnalysis' };

/** No `entries` on error: the window keeps the last good table. */
export type HostToWebview = { entries?: LogEntryView[]; error?: string; ts: number };
