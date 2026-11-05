// src/webviewClient/choreOverview/protocol.ts
//
// Messages between the Chore Overview window and its host
// (commands/chore/choreOverview.ts).
import type { ChoreOverviewRow } from '../../chore/choreTablePure';

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openChore'; name: string };

export type HostToWebview =
  | { type: 'loading'; value: boolean }
  | { type: 'error'; message: string }
  | { type: 'data'; rows: ChoreOverviewRow[]; runs: Record<string, Array<[number, number | null]>>; logReach: string; now: number };

/** window.__choreOverview: localized texts. */
export interface ChoreOverviewBootstrap {
  texts: {
    active: string; name: string; status: string; start: string; frequency: string;
    nextRun: string; mode: string; lastRun: string; duration: string; lastState: string;
    inactive: string; chores: string; tipSchedule: string; tipNextRun: string; tipLog: string;
    tipState: string; scheduled: string; ran: string; noEnd: string; every: string;
    noChoresInView: string;
  };
}

/** What the window keeps across hide/show via vscode.setState. */
export interface ChoreOverviewState { view?: 'table' | 'cal'; span?: 'day' | 'week' }
