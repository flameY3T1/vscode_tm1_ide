// src/webviewClient/cubeStats/protocol.ts
//
// Messages between the RAM dashboard and its host
// (commands/cubeViewer/cubeStatsDashboard.ts).
import type { CubeStat, StatMeasure } from '../../cubeStats/cubeStatsTypes';

export type CubeStatsToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'exportCsv'; stats: CubeStat[] };
export type CubeStatsToWebview =
  | { type: 'loading'; value: boolean }
  | { type: 'error'; message: string }
  | { type: 'data'; stats: CubeStat[] };

/** window.__cubeStats: measure columns with localized labels, plus texts. */
export interface CubeStatsBootstrap {
  measures: StatMeasure[];
  texts: { cube: string; totalRam: string; cubeCount: string; cubes: string };
}
