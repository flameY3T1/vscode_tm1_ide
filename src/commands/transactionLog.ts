import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { identityTag } from '../tm1Rest/transport/session';
import {
  fetchTransactionLogEntries, type TransactionLogQuery,
} from '../tm1Rest/transactionLogApi';
import { getCubeDimensionNames } from '../tm1Rest/cubeApi';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import type { TxBootstrap, WebviewToHost } from '../webviewClient/transactionLog/protocol';
import {
  WINDOW_HOURS, TOP_OPTIONS, MAX_TOP, WARN_SPAN_HOURS, resolveWindow, buildCellMdx,
  cellKey, planCellUndo, undoWireValue, sameCellValue, orderSameSecond, buildCellsReadMdx, type UndoEntry, type CellUndoPlan,
} from './transactionLogPure';
import { readCellValues } from '../tm1Rest/cellValues';
import { updateCells } from '../cubeViewer/cubeWriteApi';
import { CubeViewerManager } from './cubeViewer/manager';
import { getServerNameByUrl, formatServerLabel } from '../serverState/state';
import { formatTreeError } from '../providers/tm1TreeDataProviderPure';
import { isOk } from '../tm1Rest/httpError';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview } from '../webviewClient/transactionLog/protocol';

/**
 * A server's transaction log: who changed which cell, when.
 *
 * Deliberately WITHOUT a poll cycle, unlike the message log. The reason is
 * the measurement (2026-09-22, see `tm1Rest/transactionLogApi.ts`): one page
 * is up to 2.79 MB, and anyone searching the log wants to read a fixed
 * snapshot, not a table jumping every five seconds. Refreshing is a button.
 */

type Msg = WebviewToHost;

const host = new WebviewPanelHost<Msg>('tm1TransactionLog', 'TM1 Transaction Log');

export function initializeTransactionLog(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

/** Close all log windows of this server (on disconnect). */
export function disposeTransactionLogPanelsForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('transactionLogPanel', (url) => disposeTransactionLogPanelsForServer(url));

const CSS = `
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; flex-wrap: wrap; }
  .toolbar .title { font-weight: 600; margin-right: 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-border, transparent); font-weight: 600; }
  .toolbar button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .toolbar button:disabled { opacity: 0.5; cursor: default; }
  /* Undo writes to the server: visible as a real button, but not in the color of the search. */
  .toolbar button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-color: var(--vscode-button-border, transparent); font-weight: 600; }
  .toolbar button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  .toolbar button.secondary:not(:disabled) { border-color: var(--vscode-editorWarning-foreground, #cca700); }
  .toolbar select, .toolbar input[type="text"], .toolbar input[type="datetime-local"] {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 6px; font-size: 12px; border-radius: 2px;
    font-family: var(--vscode-font-family);
  }
  .toolbar input[type="text"] { width: 130px; }
  .toolbar select:focus, .toolbar input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
  /* The same arrow as in the message log, for select boxes AND fields with a
     suggestion list. Otherwise Chromium shows its own triangle on list fields only
     on hover; it stays on top of the arrow as an invisible click area.
     Stands AFTER the block above, because its background shorthand clears the image. */
  .toolbar select, .toolbar input[list] {
    appearance: none; -webkit-appearance: none;
    padding-right: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23888888' stroke-width='1.3' d='M4 6.5 8 10.5 12 6.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 4px center; background-size: 12px 12px;
  }
  .toolbar input[list]::-webkit-calendar-picker-indicator { opacity: 0; cursor: pointer; }
  .toolbar input[type="datetime-local"]::-webkit-calendar-picker-indicator { cursor: pointer; opacity: 0.7; }
  .toolbar input[type="datetime-local"]::-webkit-calendar-picker-indicator:hover { opacity: 1; }  .toolbar label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #4caf50); display: inline-block; flex-shrink: 0; }
  .dot.err { background: var(--vscode-charts-red, #f44336); }
  .dot.busy { background: var(--vscode-charts-yellow, #d7a300); }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
  #error { color: var(--vscode-errorForeground); padding: 4px 12px 8px; font-size: 12px; flex-shrink: 0; }
  #hint { color: var(--vscode-descriptionForeground); padding: 10px 12px; font-size: 12px; }
  #note { color: var(--vscode-descriptionForeground); padding: 6px 12px 0; font-size: 11px; flex-shrink: 0; }
  #note.warn { color: var(--vscode-editorWarning-foreground, #bf8803); }
  .content { padding: 0; overflow: auto; flex: 1 1 auto; min-height: 0; }
  table { min-width: 100%; border-collapse: collapse; font-size: 12px; }
  th {
    position: sticky; top: 0; z-index: 2;
    background: var(--vscode-sideBar-background, var(--vscode-editorGroupHeader-tabsBackground));
    padding: 5px 8px; text-align: left; font-weight: 600; white-space: nowrap;
    text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em;
    color: var(--vscode-descriptionForeground);
    box-shadow: inset 0 -1px 0 var(--vscode-panel-border, var(--vscode-editorGroup-border));
  }
  td { padding: 3px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); white-space: nowrap; }
  th:first-child, td:first-child { padding-left: 12px; }
  th:last-child, td:last-child { padding-right: 12px; }
  tr:hover td { background: var(--vscode-list-hoverBackground); }
  .ts, .num { font-variant-numeric: tabular-nums; }
  .num { text-align: right; }
  .usr { color: var(--vscode-descriptionForeground); }
  .cubelink { color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }
  .cubelink:hover { color: var(--vscode-textLink-activeForeground); }
  .up { color: var(--vscode-charts-green, #4caf50); }
  .down { color: var(--vscode-charts-red, #f44336); }
`;
function body(): string {
  const windowLabel = (h: number): string => h < 24
    ? vscode.l10n.t('Last {0} h', h)
    : vscode.l10n.t('Last {0} d', Math.round(h / 24));
  return `
<div class="toolbar">
  <span class="title"><span class="dot" id="dot"></span>${vscode.l10n.t('Transaction Log')}</span>
  <label>${vscode.l10n.t('From')} <input id="fromInput" type="datetime-local" /></label>
  <label>${vscode.l10n.t('To')} <input id="toInput" type="datetime-local" title="${vscode.l10n.t('Empty means: up to now.')}" /></label>
  <label>${vscode.l10n.t('Quick window')} <select id="winSel">
    <option value="">–</option>
    ${WINDOW_HOURS.map((h) => `<option value="${h}"${h === 24 ? ' selected' : ''}>${windowLabel(h)}</option>`).join('\n    ')}
  </select></label>
  <label>${vscode.l10n.t('Cube')} <input id="cubeInput" type="text" list="cubeList" placeholder="${vscode.l10n.t('exact name')}" title="${vscode.l10n.t('Exact cube name. TM1 offers no substring search on the transaction log, so a partial name finds nothing. The list suggests the cubes of the rows already loaded.')}" /></label>
  <datalist id="cubeList"></datalist>
  <label>${vscode.l10n.t('User')} <input id="userInput" type="text" list="userList" placeholder="${vscode.l10n.t('exact name')}" title="${vscode.l10n.t('Exact user name. The list suggests the users of the rows already loaded.')}" /></label>
  <datalist id="userList"></datalist>
  <label>${vscode.l10n.t('Element')} <input id="elemInput" type="text" placeholder="${vscode.l10n.t('exact name')}" title="${vscode.l10n.t('Exact element name, checked against every position of the cell coordinate. TM1 offers no substring search here.')}" /></label>
  <label><input id="ctlChk" type="checkbox" /> ${vscode.l10n.t('Control cubes')}</label>
  <label>${vscode.l10n.t('Rows')} <select id="topSel">
    ${TOP_OPTIONS.map((n) => `<option value="${n}"${n === 1000 ? ' selected' : ''}>${n}</option>`).join('\n    ')}
  </select></label>
  <button id="searchBtn" class="primary">${vscode.l10n.t('Search')}</button>
  <button id="undoBtn" class="secondary" disabled title="${vscode.l10n.t('Writes the old value of the selected entries back into their cells. Reads the current values first and asks before overwriting later changes.')}">&#x21B6; ${vscode.l10n.t('Undo selected')}</button>
  <input id="findInput" type="text" placeholder="${vscode.l10n.t('Text search…')}" title="${vscode.l10n.t('Sieves the rows already loaded.')}" />
  <div class="spacer"></div>
  <span id="status">–</span>
</div>
<div id="note"></div>
<div id="error"></div>
<div id="hint"></div>
<div class="content">
<table data-resizable>
  <thead><tr>
    <th><input id="allChk" type="checkbox" title="${vscode.l10n.t('Select all shown rows')}" /></th>
    <th>${vscode.l10n.t('Timestamp')}</th>
    <th>${vscode.l10n.t('User')}</th>
    <th>${vscode.l10n.t('Cube')}</th>
    <th>${vscode.l10n.t('Cell')}</th>
    <th>${vscode.l10n.t('Old value')}</th>
    <th>${vscode.l10n.t('New value')}</th>
    <th>${vscode.l10n.t('Status')}</th>
  </tr></thead>
  <tbody id="tbody"></tbody>
</table>
</div>
`;
}

/** Texts and threshold for the bundle (`webviewClient/transactionLog`). */
function bootstrap(): TxBootstrap {
  // Texts come from the host, so the window has no second source of language.
  const texts: TxBootstrap['texts'] = {
    empty: vscode.l10n.t('No entries in this window. A cube whose logging is switched off writes nothing to the transaction log — check LOGGING in }CubeProperties before reading this as "nothing changed".'),
    loading: vscode.l10n.t('Loading…'),
    undo: vscode.l10n.t('Undo selected'),
    shown: vscode.l10n.t('shown'),
    inWindow: vscode.l10n.t('in window'),
    truncated: vscode.l10n.t('window truncated — raise the row count or narrow the window'),
    // The notice is ALWAYS there, not only on error: the load happens while
    // searching, and anyone who only learns about it after clicking has
    // already caused it.
    load: vscode.l10n.t('A search reads the server-side transaction log. A wide interval or a search without cube and user scans a lot and can hold other users up — narrow the interval or name a cube or user.'),
    wideSpan: vscode.l10n.t('Interval spans {0} day(s). Expect a long scan and noticeable load on the server.'),
  };
  return { texts, warnSpanHours: WARN_SPAN_HOURS };
}

/**
 * ISO timestamp into the notation of a `datetime-local` field (local time,
 * minute precision, no zone). Without this, the form showed UTC while the
 * table showed local time.
 */
function toLocalField(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return ''; }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Exported for the wiring guard `src/test/commands/transactionLogWiring.test.ts`. */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  return renderWebviewShell({
    cspSource: webview.cspSource,
    css: CSS + COLUMN_RESIZE_CSS,
    body: body(),
    globals: { __tx: bootstrap() },
    scriptUris: [String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'transactionLog.js')))],
    // Column width via drag (webviews/columnResize.ts) — runs after the bundle.
    inlineScript: columnResizeScript('transactionLog', savedColumnWidths('transactionLog')),
  });
}

/**
 * Opens a log window for this server. The key starts with the server URL and
 * `::` — `disposePanelsForServer` only finds a panel when the key IS the URL or
 * starts with `${url}::` — followed by the identity tag, so a second profile
 * on the same URL gets its own window (its undo writes as that profile).
 */
export function showTransactionLogCommand(cfg: Tm1Config): void {
  const label = formatServerLabel(cfg.serverUrl, getServerNameByUrl);
  const title = label
    ? `${label} : ${vscode.l10n.t('Transaction Log')}`
    : vscode.l10n.t('Transaction Log');

  const panel = host.open({
    key: `${cfg.serverUrl}::@${identityTag(cfg)}`,
    title,
    html: (webview, extensionUri) => getHtml(webview, extensionUri),
    onMessage: async (msg, p) => {
      if (msg.type === 'load') {
        const win = resolveWindow({ fromLocal: msg.fromLocal, toLocal: msg.toLocal, hours: msg.hours });
        const q: TransactionLogQuery = {
          fromIso: win.fromIso,
          toIso: win.toIso,
          cube: msg.cube || undefined,
          user: msg.user || undefined,
          element: msg.element || undefined,
          includeControl: !!msg.includeControl,
          // Cap the same way as in the message log: the window value
          // determines `$top`, and an upper bound below the largest choice
          // would silently swallow the selection. Both come from TOP_OPTIONS.
          top: Math.min(Math.max(Math.trunc(Number(msg.top)) || 1000, 1), MAX_TOP),
        };
        try {
          const res = await fetchTransactionLogEntries(cfg, q, 60000);
          void postTo<HostToWebview>(p.webview, {
            seq: msg.seq, entries: orderSameSecond(res.entries), total: res.total,
            // Back to the form: the window ACTUALLY used.
            fromLocal: toLocalField(win.fromIso),
            toLocal: win.toIso ? toLocalField(win.toIso) : '',
          });
        } catch (err) {
          void postTo<HostToWebview>(p.webview, { seq: msg.seq, error: vscode.l10n.t(formatTreeError(err)) });
        }
        return;
      }
      if (msg.type === 'openCell') {
        await openCell(cfg, msg.cube, msg.tuple ?? []);
        return;
      }
      if (msg.type === 'undo') {
        const done = await undoEntries(cfg, msg.entries ?? []);
        void postTo<HostToWebview>(p.webview, { undoDone: true, reload: done });
      }
    },
    onError: (reason, _msg, p) => {
      void postTo<HostToWebview>(p.webview, { error: reason });
    },
  });
  // `null` means: one was already running and was brought to the front.
  if (!panel) { return; }
  rememberColumnWidths(panel, 'transactionLog');
}

/**
 * Jump from a row into the Cube Viewer.
 *
 * The tuple only names element names, not their dimensions — the dimension
 * names therefore come from the cube itself and must match by count. If they
 * do not match, the cube opens without an expression and the user learns
 * why; a guessed expression displayed a wrong cell as if it were the right
 * one.
 */
async function openCell(cfg: Tm1Config, cube: string, tuple: string[]): Promise<void> {
  if (!cube) { return; }
  let dims: string[] = [];
  try {
    dims = await getCubeDimensionNames(cfg, cube, 10000);
  } catch {
    // No abort: the cube also opens without an expression.
  }
  const mdx = buildCellMdx(cube, dims, tuple);
  if (!mdx) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('Opening {0} without the cell: the log line lists {1} element(s), the cube has {2} dimension(s).', cube, tuple.length, dims.length),
    );
    await CubeViewerManager.open(cube, cfg);
    return;
  }
  // Last argument: execute the expression, not merely offer it.
  await CubeViewerManager.open(cube, cfg, undefined, undefined, mdx, true);
}

/** Hard window per MDX query: this many cells is the most a single call reads. */
const READ_CHUNK = 500;

export interface CellJob {
  cube: string;
  tuple: string[];
  dims: string[];
  entries: UndoEntry[];
  current?: unknown;
  plan?: CellUndoPlan;
  /** Reason why the cell cannot be rolled back. */
  skip?: string;
}

/** Reads the current values of a cube's cells, in chunks. Always from the base, never from a sandbox.
 * Exported for `src/test/commands/transactionLogReadCurrent.test.ts`. */
export async function readCurrent(cfg: Tm1Config, cube: string, jobs: CellJob[]): Promise<void> {
  for (let i = 0; i < jobs.length; i += READ_CHUNK) {
    const chunk = jobs.slice(i, i + READ_CHUNK);
    const mdx = buildCellsReadMdx(cube, chunk[0].dims, chunk.map(j => j.tuple));
    if (!mdx) {
      for (const j of chunk) { j.skip = vscode.l10n.t('coordinate does not match the cube dimensions'); }
      continue;
    }
    const res = await readCellValues(cfg, mdx);
    if (!res.ok) {
      const why = `HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`;
      for (const j of chunk) { j.skip = why; }
      continue;
    }
    for (const c of res.cells) { if (chunk[c.Ordinal]) { chunk[c.Ordinal].current = c.Value; } }
  }
}

/**
 * Rolls back the selected log rows: read the current value per cell, plan
 * the chain (`planCellUndo`), confirm, write the old value.
 *
 * Writing always goes to the base — the log shows base changes, an active
 * sandbox would be the wrong target. Returns `true` when something was
 * written (the window then reloads).
 * Exported for `src/test/commands/transactionLogUndo.test.ts`.
 */
export async function undoEntries(cfg: Tm1Config, entries: UndoEntry[]): Promise<boolean> {
  const byCell = new Map<string, CellJob>();
  for (const e of entries) {
    if (!e.Cube || !e.Tuple?.length) { continue; }
    const k = cellKey(e.Cube, e.Tuple);
    const job = byCell.get(k) ?? { cube: e.Cube, tuple: e.Tuple, dims: [], entries: [] };
    job.entries.push(e);
    byCell.set(k, job);
  }
  const jobs = [...byCell.values()];
  if (jobs.length === 0) { return false; }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Reading current cell values…') },
    async () => {
      const byCube = new Map<string, CellJob[]>();
      for (const j of jobs) { byCube.set(j.cube, [...(byCube.get(j.cube) ?? []), j]); }
      for (const [cube, list] of byCube) {
        try {
          const dims = await getCubeDimensionNames(cfg, cube, 10000);
          for (const j of list) { j.dims = dims; }
          await readCurrent(cfg, cube, list);
        } catch (err) {
          for (const j of list) { j.skip = formatTreeError(err); }
        }
      }
    },
  );

  for (const j of jobs) {
    if (!j.skip && j.current === undefined) { j.skip = vscode.l10n.t('cell value not returned'); }
    if (!j.skip) { j.plan = planCellUndo(j.current, j.entries); }
    if (j.plan && j.plan.target === undefined) {
      j.skip = vscode.l10n.t('order of the oldest changes cannot be determined');
      j.plan = undefined;
    }
  }
  const planned = jobs.filter(j => j.plan);
  const skipped = jobs.filter(j => j.skip);
  const conflicts = planned.filter(j => j.plan!.conflict);

  if (planned.length === 0) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Nothing to undo: {0}', skipped[0]?.skip ?? ''));
    return false;
  }

  const undoAll = vscode.l10n.t('Undo');
  const overwrite = vscode.l10n.t('Overwrite later changes too');
  const onlyClean = vscode.l10n.t('Skip changed cells');
  const lines = [
    vscode.l10n.t('Write the old values back into {0} cell(s)? The undo itself appears in the transaction log.', planned.length),
  ];
  if (conflicts.length > 0) {
    lines.push(vscode.l10n.t('{0} cell(s) were changed again after the selected entries. Undoing them also overwrites those later changes.', conflicts.length));
  }
  if (skipped.length > 0) {
    lines.push(vscode.l10n.t('{0} cell(s) cannot be read and are left out: {1}', skipped.length, skipped[0].skip ?? ''));
  }
  const buttons = conflicts.length > 0 ? [overwrite, onlyClean] : [undoAll];
  const pick = await vscode.window.showWarningMessage(lines[0], { modal: true, detail: lines.slice(1).join('\n\n') }, ...buttons);
  if (!pick) { return false; }
  const todo = pick === onlyClean ? planned.filter(j => !j.plan!.conflict) : planned;

  let ok = 0;
  let unchanged = 0;
  const failed: string[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Undoing changes…') },
    async (progress) => {
      for (const j of todo) {
        const value = undoWireValue(j.plan!.target ?? null, j.current);
        if (sameCellValue(j.current, value)) { unchanged++; continue; }
        try {
          const res = await updateCells(j.cube, [{ Dimensions: j.dims, Coordinates: j.tuple, Value: value }], cfg, false);
          if (res && isOk(res)) { ok++; }
          else { failed.push(`${j.cube} (${j.tuple.join(', ')}): HTTP ${res?.statusCode} ${String(res?.body ?? '').slice(0, 200)}`); }
        } catch (err) {
          failed.push(`${j.cube} (${j.tuple.join(', ')}): ${formatTreeError(err)}`);
        }
        progress.report({ increment: 100 / todo.length });
      }
    },
  );

  const summary = vscode.l10n.t('{0} cell(s) restored, {1} already at the old value, {2} failed.', ok, unchanged, failed.length);
  if (failed.length > 0) {
    void vscode.window.showErrorMessage(`${summary} ${failed[0]}`);
  } else {
    void vscode.window.showInformationMessage(summary);
  }
  return ok > 0;
}

