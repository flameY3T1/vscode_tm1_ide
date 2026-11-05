import type { ColumnDef, KpiDef, OverviewRow, KpiValue, ColumnPatch } from './overviewTypes';

/** Extension → webview. */
export type HostToOverview =
  | { type: 'init'; columns: ColumnDef[]; kpis: KpiDef[]; i18n: Record<string, string>; controlNoun: string }
  | { type: 'rows'; rows: OverviewRow[]; kpis: KpiValue[] }
  | { type: 'patch'; patches: ColumnPatch[] }
  | { type: 'kpi'; kpis: KpiValue[] }
  | { type: 'loading'; on: boolean }
  | { type: 'error'; message: string };

/** Webview → extension. Control-object filtering is client-side (no message). */
export type OverviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openRow'; id: string };
