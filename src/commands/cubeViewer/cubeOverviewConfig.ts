// src/commands/cubeViewer/cubeOverviewConfig.ts
import * as vscode from 'vscode';
import type { OverviewConfig } from '../../webviews/objectOverview/overviewManager';
import type { ColumnDef, KpiDef, ColumnPatch, KpiValue } from '../../webviews/objectOverview/overviewTypes';
import { NO_VALUE } from '../../webviews/objectOverview/overviewCellsPure';
import { listCubesOverview, fetchAllCubeRules, fetchAllCubeViewCounts } from '../../tm1Rest/cubeApi';
import { buildCubeRows, buildCubeKpis, hasFeeders, ruleLineCount } from './cubeOverviewPure';
import { fetchAllCubeStats, formatBytes } from '../../cubeStats/cubeStatsApi';
import { getServerIdByUrl } from '../../serverState/state';

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'link', sortable: true },
  { key: 'dims', label: '#Dims', kind: 'number', sortable: true },
  { key: 'dimList', label: 'Dimensions', kind: 'badges', sortable: false },
  { key: 'hasRules', label: 'Rules', kind: 'flag', sortable: true, lazy: true },
  { key: 'ruleLines', label: 'Rule lines', kind: 'number', sortable: true, lazy: true },
  { key: 'hasFeeders', label: 'Feeders', kind: 'flag', sortable: true, lazy: true },
  { key: 'cells', label: 'Cells', kind: 'number', sortable: true, lazy: true },
  { key: 'ram', label: 'RAM', kind: 'text', sortable: true, lazy: true },
  { key: 'views', label: 'Views', kind: 'number', sortable: true, lazy: true },
  { key: 'fedRatio', label: 'Fed / populated', kind: 'text', align: 'right', sortable: true, lazy: true },
  { key: 'cacheMiss', label: 'Cache miss', kind: 'text', align: 'right', sortable: true, lazy: true },
];

const KPIS: KpiDef[] = [
  { key: 'total', label: 'Cubes' },
  { key: 'ram', label: 'Σ RAM' },
  { key: 'withRules', label: 'With rules' },
  { key: 'withFeeders', label: 'With feeders' },
  { key: 'overfed', label: 'Fed ≥ 10× populated' },
];

// ponytail: fixed threshold, a hint and no verdict. A cube calculated
// entirely by rules legitimately feeds far more cells than it stores; make it a
// setting when that shows up as noise. Test server (2026-09-27): highest ratio 2x.
const OVERFED_RATIO = 10;

/** Fed cells per populated numeric cell; undefined when nothing is fed. */
function fedRatio(fed: number, populated: number): number | undefined {
  if (fed <= 0) { return undefined; }
  return populated > 0 ? fed / populated : Infinity;
}

function formatRatio(r: number): string {
  if (!Number.isFinite(r)) { return '∞'; }
  return `${r >= 10 ? r.toFixed(0) : r.toFixed(2)}×`;
}


export function buildCubeOverviewConfig(): OverviewConfig {
  return {
    viewType: 'tm1CubeOverview',
    title: vscode.l10n.t('Cube Overview'),
    controlNoun: vscode.l10n.t('cubes'),
    columns: COLUMNS,
    kpis: KPIS,
    baseFetch: async (cfg) => {
      const raw = await listCubesOverview(cfg);
      const rows = buildCubeRows(raw);
      return { rows, kpis: buildCubeKpis(rows) };
    },
    lazyFetch: async (cfg, rows, emit) => {
      // Rules + feeders: one call for the whole server, not one per cube.
      const allRules = await fetchAllCubeRules(cfg).catch(() => null);
      const ruleResults = rows.map(r => {
        const text = allRules?.get(r.id);
        return text === undefined
          ? { id: r.id, ok: false, has: false, lines: 0, feeders: false }
          : { id: r.id, ok: true, has: text.trim().length > 0, lines: ruleLineCount(text), feeders: hasFeeders(text) };
      });
      const rulePatches: ColumnPatch[] = [];
      const withRules: string[] = [];
      const withFeeders: string[] = [];
      for (const rr of ruleResults) {
        // Only a confirmed successful fetch may count/display a real value — a
        // failed fetch must not masquerade as "no rules" / "0 lines", and must
        // resolve to NO_VALUE rather than null (null = still loading → spinner).
        if (rr.ok && rr.has) { withRules.push(rr.id); }
        if (rr.ok && rr.feeders) { withFeeders.push(rr.id); }
        rulePatches.push({ rowId: rr.id, columnKey: 'hasRules', value: rr.ok ? rr.has : NO_VALUE });
        rulePatches.push({ rowId: rr.id, columnKey: 'ruleLines', value: rr.ok ? rr.lines : NO_VALUE });
        rulePatches.push({ rowId: rr.id, columnKey: 'hasFeeders', value: rr.ok ? rr.feeders : NO_VALUE });
      }
      emit({ type: 'patch', patches: rulePatches });

      // View counts: one call for the whole server.
      const allViews = await fetchAllCubeViewCounts(cfg).catch(() => null);
      const viewResults = rows.map(r => {
        const views = allViews?.get(r.id);
        return { id: r.id, ok: views !== undefined, views: views ?? 0 };
      });
      emit({
        type: 'patch',
        patches: viewResults.map(vr => ({ rowId: vr.id, columnKey: 'views', value: vr.ok ? vr.views : NO_VALUE })),
      });

      // RAM/cells from }StatsByCube (server may not have it — degrade to "—").
      let sumRam = 0;
      let anyStats = false;
      const overfed: string[] = [];
      try {
        const stats = await fetchAllCubeStats(cfg);
        const statPatches: ColumnPatch[] = [];
        for (const r of rows) {
          const s = stats.get(r.id);
          const ram = s?.values.totalMemoryBytes ?? 0;
          const cells = s ? (s.values.numericCells ?? 0) + (s.values.stringCells ?? 0) : 0;
          // Carry the raw byte count: the column shows "1.02 GB"/"842 MB", which
          // sorts nonsensically as text. Cubes without stats get no sortValue
          // and land last instead of masquerading as 0 bytes.
          statPatches.push(s
            ? { rowId: r.id, columnKey: 'ram', value: formatBytes(ram), sortValue: ram }
            : { rowId: r.id, columnKey: 'ram', value: NO_VALUE });
          statPatches.push({ rowId: r.id, columnKey: 'cells', value: s ? cells : NO_VALUE });
          const ratio = s ? fedRatio(s.values.fedCells ?? 0, s.values.numericCells ?? 0) : undefined;
          statPatches.push(ratio !== undefined
            ? { rowId: r.id, columnKey: 'fedRatio', value: formatRatio(ratio), sortValue: ratio }
            : { rowId: r.id, columnKey: 'fedRatio', value: NO_VALUE });
          // Control cubes (}ClientSettings & co.) are hidden in the table by default; a tile
          // that counts them would promise rows the click cannot show.
          if (ratio !== undefined && ratio >= OVERFED_RATIO && !r.isControl) { overfed.push(r.id); }
          const miss = s?.values.cacheMissRate;
          // Only rule cubes that were queried have a rate; everything else stays "—".
          statPatches.push(miss
            // }StatsByCube delivers a percentage (live: 76). A "<= 1 means fraction"
            // guess turned a real 0.8 % into 80 %.
            ? { rowId: r.id, columnKey: 'cacheMiss', value: `${miss.toFixed(1)} %`, sortValue: miss }
            : { rowId: r.id, columnKey: 'cacheMiss', value: NO_VALUE });
          if (s) { sumRam += ram; anyStats = true; }
        }
        emit({ type: 'patch', patches: statPatches });
      } catch {
        // }StatsByCube unavailable → resolve the lazy ram/cells spinners to "—"
        emit({
          type: 'patch',
          patches: rows.flatMap(r => [
            { rowId: r.id, columnKey: 'ram', value: NO_VALUE },
            { rowId: r.id, columnKey: 'cells', value: NO_VALUE },
            { rowId: r.id, columnKey: 'fedRatio', value: NO_VALUE },
            { rowId: r.id, columnKey: 'cacheMiss', value: NO_VALUE },
          ]),
        });
      }

      const kpis: KpiValue[] = [
        { key: 'total', label: 'Cubes', value: String(rows.length) },
        { key: 'ram', label: 'Σ RAM', value: anyStats ? formatBytes(sumRam) : NO_VALUE },
        { key: 'withRules', label: 'With rules', value: String(withRules.length), rowIds: withRules },
        { key: 'withFeeders', label: 'With feeders', value: String(withFeeders.length), rowIds: withFeeders },
        { key: 'overfed', label: 'Fed ≥ 10× populated', value: anyStats ? String(overfed.length) : NO_VALUE, rowIds: overfed },
      ];
      emit({ type: 'kpi', kpis });
    },
    openEditor: (cfg, id) => {
      const serverId = getServerIdByUrl(cfg.serverUrl);
      void vscode.commands.executeCommand('tm1.openCubeViewer', { meta: { cubeName: id, serverId } });
    },
  };
}
