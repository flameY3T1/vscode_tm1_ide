// src/commands/applicationOverviewConfig.ts
import * as vscode from 'vscode';
import type { OverviewConfig } from '../webviews/objectOverview/overviewManager';
import type { ColumnDef, ColumnPatch, KpiDef } from '../webviews/objectOverview/overviewTypes';
import { NO_VALUE } from '../webviews/objectOverview/overviewCellsPure';
import { mapPool } from '../webviews/objectOverview/pool';
import { walkApplications, getDocumentContent, fetchServerName, type AppTreeEntry } from '../tm1Rest/applicationsApi';
import { fetchNames } from '../providers/fetchNames';
import { formatBytes } from '../cubeStats/cubeStatsApi';
import { getServerIdByUrl } from '../serverState/state';
import { openAppDocument } from './applicationCommands';
import { errMsg } from '../utils/errMsg';
import {
  appRowId, buildAppKpis, buildAppRows, missingRefs, refLabel, scanWorkbook, tm1NameKey,
  DEFINED_NAMES, type WorkbookRef,
} from './applicationOverviewPure';

const t = (s: string) => vscode.l10n.t(s);

// Last walk per server: the row click needs the entry behind a row id.
const lastWalk = new Map<string, Map<string, AppTreeEntry>>();

export function buildApplicationOverviewConfig(): OverviewConfig {
  // What the page is for comes first; path and metadata to the right, where
  // a narrow window cuts off.
  const columns: ColumnDef[] = [
    { key: 'name', label: t('Name'), kind: 'link', sortable: true },
    { key: 'missing', label: t('Missing on server'), kind: 'badges', sortable: true, lazy: true },
    { key: 'cubes', label: t('Cubes in formulas'), kind: 'badges', sortable: true, lazy: true },
    { key: 'dimensions', label: t('Dimensions in formulas'), kind: 'badges', sortable: true, lazy: true },
    { key: 'folder', label: t('Folder'), kind: 'text', sortable: true },
    { key: 'type', label: t('Type'), kind: 'text', sortable: true },
    { key: 'size', label: t('Size'), kind: 'text', align: 'right', sortable: true },
    { key: 'updated', label: t('Last changed'), kind: 'text', sortable: true },
    { key: 'private', label: t('Private'), kind: 'flag', sortable: true },
    { key: 'target', label: t('Target'), kind: 'text', sortable: true },
  ];
  const kpis: KpiDef[] = [
    { key: 'folders', label: t('Folders') },
    { key: 'size', label: t('Σ size') },
    { key: 'stale', label: t('Unchanged > 2 years') },
    { key: 'broken', label: t('References without target') },
    { key: 'missingWb', label: t('Workbooks with missing objects') },
  ];
  return {
    viewType: 'tm1ApplicationOverview',
    title: t('Applications Overview'),
    controlNoun: t('applications'),
    columns,
    kpis,
    baseFetch: async (cfg) => {
      const all = await walkApplications(cfg);
      const entries = all.filter(e => e.type !== 'folder');
      lastWalk.set(cfg.serverUrl ?? '', new Map(entries.map(e => [appRowId(e), e])));
      return {
        rows: buildAppRows(entries, t, NO_VALUE, formatBytes),
        kpis: buildAppKpis(all, Date.now(), t, formatBytes),
      };
    },
    lazyFetch: async (cfg, _rows, emit) => {
      const byId = lastWalk.get(cfg.serverUrl ?? '');
      const workbooks = [...(byId?.values() ?? [])].filter(e => e.type === 'document');
      const [serverName, cubeNames, dimNames] = await Promise.all([
        fetchServerName(cfg).catch(() => ''),
        fetchNames('Cubes', cfg),
        fetchNames('Dimensions', cfg),
      ]);
      const cubes = new Set(cubeNames.map(tm1NameKey));
      const dims = new Set(dimNames.map(tm1NameKey));
      // An empty name list means the fetch failed (fetchNames swallows errors):
      // judging against it would flag every reference as missing.
      const canJudge = cubes.size > 0 && dims.size > 0;
      const withMissing: string[] = [];
      // Download + unzip per workbook, pooled; patches go out per batch so the
      // table fills while the rest loads (test server: 112 documents, 10 MB).
      const BATCH = 12;
      for (let i = 0; i < workbooks.length; i += BATCH) {
        const patches: ColumnPatch[] = [];
        await mapPool(workbooks.slice(i, i + BATCH), 6, async (e) => {
          const id = appRowId(e);
          try {
            const refs = await scanWorkbook(await getDocumentContent(e.folderPath, e.id, e.isPrivate, cfg));
            if (!refs) { throw new Error('not a workbook'); }
            const missing = canJudge ? missingRefs(refs, serverName, cubes, dims) : [];
            if (missing.length) { withMissing.push(id); }
            const badges = (list: WorkbookRef[]) => ({
              value: list.map(r => refLabel(r, serverName)),
              badgeTitles: Object.fromEntries(list.map(r => [refLabel(r, serverName), sheetsTitle(r)])),
            });
            patches.push(
              { rowId: id, columnKey: 'cubes', ...badges(refs.filter(r => r.kind === 'cube')) },
              { rowId: id, columnKey: 'dimensions', ...badges(refs.filter(r => r.kind === 'dimension')) },
              canJudge ? { rowId: id, columnKey: 'missing', ...badges(missing), sortValue: missing.length } : { rowId: id, columnKey: 'missing', value: NO_VALUE },
            );
          } catch {
            for (const k of ['cubes', 'dimensions', 'missing']) { patches.push({ rowId: id, columnKey: k, value: NO_VALUE }); }
          }
        });
        emit({ type: 'patch', patches });
      }
      emit({ type: 'kpi', kpis: [{ key: 'missingWb', label: t('Workbooks with missing objects'), value: canJudge ? String(withMissing.length) : NO_VALUE, rowIds: withMissing }] });
    },
    openEditor: (cfg, id) => { void openEntry(cfg, lastWalk.get(cfg.serverUrl ?? '')?.get(id)); },
  };
}

/** Badge tooltip: `Name — sheets: Input, Report`. */
function sheetsTitle(r: WorkbookRef): string {
  const sheets = r.sheets.map(sh => (sh === DEFINED_NAMES ? t('defined names') : sh));
  return vscode.l10n.t('{0} — sheets: {1}', r.name, sheets.join(', '));
}

/** Same actions as a click on the tree node. */
async function openEntry(cfg: Parameters<OverviewConfig['openEditor']>[0], e: AppTreeEntry | undefined): Promise<void> {
  if (!e) { return; }
  const serverId = getServerIdByUrl(cfg.serverUrl);
  const tg = e.target ?? {};
  try {
    switch (e.type) {
      case 'document': {
        const buf = await getDocumentContent(e.folderPath, e.id, e.isPrivate, cfg);
        await openAppDocument(e.name, buf);
        return;
      }
      case 'link':
        if (e.url && /^https?:\/\//i.test(e.url)) { await vscode.env.openExternal(vscode.Uri.parse(e.url)); }
        return;
      case 'cubeRef': case 'viewRef':
        if (tg.cubeName) { await vscode.commands.executeCommand('tm1.openCubeViewer', { meta: { serverId, cubeName: tg.cubeName, viewName: tg.viewName } }); }
        return;
      case 'processRef':
        if (tg.processName) { await vscode.commands.executeCommand('tm1.openProcessEditor', { meta: { serverId, processName: tg.processName } }); }
        return;
      case 'choreRef':
        if (tg.choreName) { await vscode.commands.executeCommand('tm1.editChore', { meta: { serverId, choreName: tg.choreName } }); }
        return;
      case 'dimensionRef':
        if (tg.dimensionName) { await vscode.commands.executeCommand('tm1.browseElements', { meta: { serverId, dimName: tg.dimensionName } }); }
        return;
      default: return; // folder / subsetRef / unknown: no editor to open
    }
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: {0}', errMsg(err)));
  }
}
