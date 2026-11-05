// src/commands/dimension/dimensionOverviewConfig.ts
import * as vscode from 'vscode';
import type { OverviewConfig } from '../../webviews/objectOverview/overviewManager';
import type { ColumnDef, KpiDef, ColumnPatch } from '../../webviews/objectOverview/overviewTypes';
import { listDimensionsOverview, fetchDimensionAttributeNames, fetchDimensionCubeNames } from '../../tm1Rest/dimensionApi';
import { buildDimensionRows, buildDimensionKpis } from './dimensionOverviewPure';
import { getServerIdByUrl } from '../../serverState/state';

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', kind: 'link', sortable: true },
  { key: 'hierarchies', label: 'Hierarchies', kind: 'badges', sortable: false },
  { key: 'elements', label: 'Elements', kind: 'number', sortable: true },
  { key: 'attributes', label: 'Attributes', kind: 'badges', sortable: false, lazy: true },
  { key: 'usedInCubes', label: 'Cubes', kind: 'badges', sortable: false, lazy: true },
];

const KPIS: KpiDef[] = [
  { key: 'total', label: 'Dimensions' },
  { key: 'elements', label: 'Σ elements' },
  { key: 'alt', label: 'With alt. hierarchies' },
  { key: 'largest', label: 'Largest' },
  { key: 'noCube', label: 'In no cube' },
];

export function buildDimensionOverviewConfig(): OverviewConfig {
  return {
    viewType: 'tm1DimensionOverview',
    title: vscode.l10n.t('Dimension Overview'),
    controlNoun: vscode.l10n.t('dimensions'),
    columns: COLUMNS,
    kpis: KPIS,
    baseFetch: async (cfg) => {
      const raw = await listDimensionsOverview(cfg);
      const rows = buildDimensionRows(raw);
      const kpis = buildDimensionKpis(rows);
      return { rows, kpis };
    },
    lazyFetch: async (cfg, rows, emit) => {
      const [attrs, cubes] = await Promise.all([
        fetchDimensionAttributeNames(cfg).catch(() => new Map<string, string[]>()),
        fetchDimensionCubeNames(cfg).catch(() => new Map<string, string[]>()),
      ]);
      const patches: ColumnPatch[] = [];
      for (const r of rows) {
        patches.push({ rowId: r.id, columnKey: 'attributes', value: attrs.has(r.id) ? attrs.get(r.id)! : '—' });
        patches.push({ rowId: r.id, columnKey: 'usedInCubes', value: cubes.has(r.id) ? cubes.get(r.id)! : '—' });
      }
      emit({ type: 'patch', patches });
      // Only with a cube map in hand: an empty map means the fetch failed, and
      // every dimension would count as unused.
      if (cubes.size > 0) {
        const unused = rows.filter(r => !r.isControl && !cubes.has(r.id)).map(r => r.id);
        emit({ type: 'kpi', kpis: [{ key: 'noCube', label: vscode.l10n.t('In no cube'), value: String(unused.length), rowIds: unused }] });
      }
    },
    openEditor: (cfg, id) => {
      const serverId = getServerIdByUrl(cfg.serverUrl);
      // Open the read-only dimension VIEWER (browser), not the editor.
      void vscode.commands.executeCommand('tm1.browseElements', { meta: { dimName: id, serverId } });
    },
  };
}
