// src/commands/process/processOverviewConfig.ts
import * as vscode from 'vscode';
import type { OverviewConfig } from '../../webviews/objectOverview/overviewManager';
import type { ColumnDef, KpiDef, ColumnPatch } from '../../webviews/objectOverview/overviewTypes';
import { listProcessesFull, type RawProcess, type ProcessParameter, type ProcessVariable } from '../../tm1Rest/processApi';
import { lintAllSections } from '../processEditor/processEditorLint';
import type { LintDiagnose } from '../../tiLogicVisualizer/lintTypes';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { fetchProcessRunStats } from '../../tm1Rest/runStatsApi';
import { formatEpochMinute, formatDurationSec } from '../../tm1Rest/runStats';
import { NO_VALUE } from '../../webviews/objectOverview/overviewCellsPure';
import { buildProcessRows, buildProcessKpis } from './processOverviewPure';
import { getServerIdByUrl } from '../../serverState/state';

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'link', sortable: true },
  { key: 'params', label: '#Params', kind: 'number', sortable: true },
  { key: 'datasource', label: 'Datasource', kind: 'text', sortable: true },
  { key: 'sections', label: 'Sections', kind: 'badges', sortable: false },
  { key: 'lines', label: 'Lines', kind: 'number', sortable: true },
  { key: 'security', label: 'Security', kind: 'flag', sortable: true },
  { key: 'calls', label: 'Calls', kind: 'number', sortable: true },
  { key: 'calledBy', label: 'Called by', kind: 'number', sortable: true },
  { key: 'lastRun', label: 'Last run', kind: 'text', sortable: true, lazy: true },
  { key: 'duration', label: 'Duration', kind: 'text', align: 'right', sortable: true, lazy: true },
  { key: 'lintErrors', label: 'Lint errors', kind: 'number', sortable: true, lazy: true },
  { key: 'lintWarnings', label: 'Lint warnings', kind: 'number', sortable: true, lazy: true },
];

const KPIS: KpiDef[] = [
  { key: 'total', label: 'Processes' },
  { key: 'datasource', label: 'Datasource' },
  { key: 'noDoc', label: 'No doc comment' },
  { key: 'lintErrors', label: 'With lint errors' },
];

// Last listing per server: the lint pass needs the code, rows carry only counts.
const lastRaw = new Map<string, RawProcess[]>();

/**
 * Error and warning counts as the process editor would show them (same rules,
 * same per-server rule config, same suppressions), without the server pass.
 */
const lf = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n');

function lintCounts(p: RawProcess, cfg: Tm1Config): { errors: number; warnings: number } {
  const diags: LintDiagnose[] = [];
  const sink = { webview: { postMessage: (m: { type?: string; diagnostics?: LintDiagnose[] }) => {
    if (m.type === 'lintResults') { diags.push(...(m.diagnostics ?? [])); }
  } } };
  lintAllSections(sink, {
    // Same text the editor lints: it loads with CRLF turned into LF.
    prolog: lf(p.PrologProcedure),
    metadata: lf(p.MetadataProcedure),
    data: lf(p.DataProcedure),
    epilog: lf(p.EpilogProcedure),
    parameters: (p.Parameters ?? []) as ProcessParameter[],
    variables: (p.Variables ?? []) as ProcessVariable[],
    processName: p.Name,
  }, { value: 0 }, cfg, cfg.serverUrl ?? '__default__', { serverLint: false });
  return {
    errors: diags.filter(d => d.severity === 'error').length,
    warnings: diags.filter(d => d.severity === 'warning').length,
  };
}

export function buildProcessOverviewConfig(): OverviewConfig {
  return {
    viewType: 'tm1ProcessOverview',
    title: vscode.l10n.t('Process Overview'),
    controlNoun: vscode.l10n.t('processes'),
    columns: COLUMNS,
    kpis: KPIS,
    baseFetch: async (cfg) => {
      const raw = await listProcessesFull(cfg);
      lastRaw.set(cfg.serverUrl ?? '', raw);
      const rows = buildProcessRows(raw);
      const kpis = buildProcessKpis(rows);
      return { rows, kpis };
    },
    lazyFetch: async (cfg, rows, emit) => {
      const stats = await fetchProcessRunStats(cfg);
      const patches: ColumnPatch[] = [];
      for (const r of rows) {
        const s = stats.get(r.id);
        patches.push({
          rowId: r.id,
          columnKey: 'lastRun',
          value: s?.lastEnd ? formatEpochMinute(s.lastEnd) : NO_VALUE,
        });
        patches.push({
          rowId: r.id,
          columnKey: 'duration',
          // Formatted text sorts alphabetically ("2m 03s" < "9s"), so the raw
          // seconds ride along as the sort key.
          value: s?.duration !== undefined ? formatDurationSec(s.duration) : NO_VALUE,
          sortValue: s?.duration,
        });
      }
      emit({ type: 'patch', patches });

      // Lint pass: CPU only, but a few hundred processes block the extension
      // host noticeably — batches with a yield in between keep it responsive.
      // Taken, not read: the listing holds every process's code (MBs on large
      // servers) and nothing else needs it once the counts are out.
      const raw = lastRaw.get(cfg.serverUrl ?? '') ?? [];
      lastRaw.delete(cfg.serverUrl ?? '');
      const withErrors: string[] = [];
      for (let i = 0; i < raw.length; i += 20) {
        const lintPatches: ColumnPatch[] = [];
        for (const p of raw.slice(i, i + 20)) {
          try {
            const c = lintCounts(p, cfg);
            if (c.errors > 0) { withErrors.push(p.Name); }
            lintPatches.push({ rowId: p.Name, columnKey: 'lintErrors', value: c.errors },
              { rowId: p.Name, columnKey: 'lintWarnings', value: c.warnings });
          } catch {
            lintPatches.push({ rowId: p.Name, columnKey: 'lintErrors', value: NO_VALUE },
              { rowId: p.Name, columnKey: 'lintWarnings', value: NO_VALUE });
          }
        }
        emit({ type: 'patch', patches: lintPatches });
        await new Promise(r => setImmediate(r));
      }
      emit({ type: 'kpi', kpis: [{ key: 'lintErrors', label: 'With lint errors', value: String(withErrors.length), rowIds: withErrors }] });
    },
    openEditor: (cfg, id) => {
      const serverId = getServerIdByUrl(cfg.serverUrl);
      void vscode.commands.executeCommand('tm1.openProcessEditor', { meta: { processName: id, serverId } });
    },
  };
}
