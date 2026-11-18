// src/webviewClient/messageLog/protocol.ts
//
// Messages between the Message Log window and its host (commands/messageLog.ts).
import type { KnownLogger } from '../../messageLog/messageLogPure';

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
  /** v12 only: the process the line belongs to (v11 has it in the message). */
  Name?: string;
  /** v12 only: the thread number inside the run, shown where v11 has `ThreadID`. */
  RunThread?: number;
}

export type Levels = { info: boolean; warn: boolean; error: boolean; debug: boolean };

export type WebviewToHost =
  | { command: 'setTop'; top: number }
  | { command: 'setLevels'; levels: Levels }
  | { command: 'setLoggers'; excluded: string[] }
  | { command: 'loadLoggers' }
  | { command: 'exportCsv'; csv: string }
  | { command: 'openErrorLog'; file: string }
  | { command: 'openStartup' }
  | { command: 'openAnalysis' };

/** How the search for all loggers with rows ended; `failed` may be retried. */
export type LoggerWalkEnd = 'done' | 'capped' | 'failed';

export type HostToWebview =
  /** No `entries` on error: the window keeps the last good table. */
  | { entries?: LogEntryView[]; error?: string; ts: number }
  /** One logger the walk found; they arrive one by one, newest first. */
  | { logger: KnownLogger }
  | { loggerWalk: LoggerWalkEnd; error?: string };
