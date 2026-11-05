// src/webviewClient/bulkDelete/index.ts
// Bundle of the bulk delete page. Holds the selection, filters the rows and
// computes the lock against the CURRENT selection — a dimension whose
// holding cubes are also marked is not locked (see `bulkDeletePure`).
import { isBlocked, blockingHolders } from '../../webviews/bulkDeletePure';
import { matchesPattern, capNames, rowKey, rowOwner, rowLabel } from '../../webviews/bulkObjectsPure';
import { type ObjKind } from '../../utils/objectKinds';
import type { L10nMap } from '../_shared/l10n';
import {
  activeKinds, appendDetailLine, buildDetailShell, buildRowShell, bulkText,
  headBoxChecked, wireBulkTable, wireRowClick,
} from '../_shared/bulkTable';
import type { BulkRow, HostToWebview, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost>();

let l10n: L10nMap = {};
let rows: BulkRow[] = [];
/** `kind|name` of the checked rows — survives a filter change. */
const selected = new Set<string>();
/** Which kinds the host could not list. */
let failedKinds: ObjKind[] = [];
let usageLoaded = false;
let incomplete: string[] = [];
/** Before the first search there is no empty list, but no list at all. */
let searched = false;
/**
 * Current job generation.
 *
 * Every search increments it; the check and the delete run under the SAME
 * generation as the table they refer to. Replies from an
 * older generation are discarded — otherwise a slow
 * first search overwrites the fast second one, or a check puts its results on
 * a table that no longer exists.
 */
let gen = 0;
/** Processes whose data source comes from a variable in the code. */
let dynamicDataSources: string[] = [];

const $ = (id: string) => document.getElementById(id)!;
const tbody = $('bd-tbody');
const patternInput = $('bd-pattern') as HTMLInputElement;
const controlBox = $('bd-control') as HTMLInputElement;
const headBox = $('bd-head-box') as HTMLInputElement;
const countEl = $('bd-count');
const busyEl = $('bd-busy');
const noteEl = $('bd-note');
const errorEl = $('bd-error');
const emptyEl = $('bd-empty');
const deleteBtn = $('bd-delete') as HTMLButtonElement;
const searchBtn = $('bd-search') as HTMLButtonElement;
const usageBtn = $('bd-usage') as HTMLButtonElement;
const searchHint = $('bd-search-hint');

/**
 * How many names fit into the expanded row. After that the
 * usage view takes over: 300 names side by side are no longer useful information, and
 * there they are grouped, with location and a jump to the object.
 */
const DETAIL_CAP = 30;

/** Which rows are expanded — survives a redraw. */
const expanded = new Set<string>();

/** Kinds for which `tm1.findReferences` knows a target. */
const USAGE_LINK_KINDS = new Set<ObjKind>(['cube', 'dimension', 'process', 'chore']);

const { t, kindLabel } = bulkText(() => l10n);

function visibleRows(): BulkRow[] {
  const kinds = activeKinds();
  const pattern = patternInput.value;
  const withControl = controlBox.checked;
  // The pattern runs against the name, not against `Cube / View` — otherwise
  // `Sales*` would find every view in every cube that starts that way.
  return rows.filter(r =>
    kinds.has(r.kind) && (withControl || !r.isControl) && matchesPattern(r.name, pattern));
}

/**
 * What a row says about its dependencies.
 *
 * Split by what makes the table scannable at a glance: `status` answers
 * "can this be deleted?", the numbers answer "how much breaks then?",
 * and the names are in the detail row. Previously everything stood together as
 * one running text in a cell — two rows below each other were therefore not
 * comparable, because nothing lined up.
 */
interface RowInfo {
  status: string;
  /** Full holder list for the mouse pointer on the status cell. */
  statusTitle: string;
  locked: boolean;
  counts: { processes: number; rules: number; chores: number; views: number; subsets: number };
  lines: Array<{ label: string; names: string[] }>;
}

function rowInfo(r: BulkRow): RowInfo {
  const none: RowInfo = {
    status: t('usageIdle'), statusTitle: '', locked: false,
    counts: { processes: -1, rules: -1, chores: -1, views: -1, subsets: -1 }, lines: [],
  };
  // Not checked is not the same as "nothing found": the check is
  // a separate button, and as long as it has not been pressed, neither
  // numbers nor a "free" appear here (`-1` means: no number, not zero).
  if (!usageLoaded || !r.usage) { return none; }

  // `selected` carries exactly the keys that `isBlocked` checks against: a
  // holder is marked along when ITS row is checked. Previously it was
  // only the names of the marked cubes — a view as holder did not appear in it
  // at all.
  const locked = isBlocked(r.usage, selected);
  // The same names that decide the lock — control cubes do not
  // count, otherwise there would be a warning here with no counterpart in the result.
  const holders = blockingHolders(r.usage.hard);
  const soft = r.usage.soft;

  const lines: Array<{ label: string; names: string[] }> = [];
  // With the kind in front: `Standard` as a view and `Standard` as a cube are two
  // different things, and only one of them needs to be touched.
  if (holders.length > 0) {
    lines.push({
      label: t('detailHeld'),
      names: holders.map(h => `${kindLabel(h.kind)} ${rowLabel(h)}`),
    });
  }
  if (soft.processes.length > 0)   { lines.push({ label: t('kindProcesses'), names: soft.processes }); }
  if (soft.rules.length > 0)       { lines.push({ label: t('colRules'), names: soft.rules }); }
  if (soft.chores.length > 0)      { lines.push({ label: t('kindChores'), names: soft.chores }); }
  if (soft.views.length > 0)       { lines.push({ label: t('kindViews'), names: soft.views }); }
  if (soft.subsets.length > 0)     { lines.push({ label: t('kindSubsets'), names: soft.subsets }); }

  // An incomplete index must not claim "free" — that is exactly the
  // information someone deletes on the basis of.
  const clear = incomplete.length > 0 ? t('usageUnknown') : t('statusFree');
  return {
    status: holders.length > 0
      ? (locked ? '⚠ ' : '') + t('statusHeld', String(holders.length))
      : clear,
    statusTitle: holders.map(h => `${kindLabel(h.kind)} ${rowLabel(h)}`).join(', '),
    locked,
    counts: {
      processes: soft.processes.length,
      rules: soft.rules.length,
      chores: soft.chores.length,
      views: soft.views.length,
      subsets: soft.subsets.length,
    },
    lines,
  };
}

/** A number cell. `-1` means "not checked", `0` becomes a dash. */
function numCell(n: number): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = n === 0 ? 'bd-num bd-zero' : 'bd-num';
  td.textContent = n < 0 ? '' : n === 0 ? '–' : String(n);
  return td;
}

/** The expanded row: one line per heading with the names. */
function detailRow(r: BulkRow, info: RowInfo): HTMLTableRowElement {
  // Two empty fields — checkbox and arrow — then the text begins under
  // the type column.
  const { tr, td } = buildDetailShell(8);
  for (const line of info.lines) {
    const { shown, rest } = capNames(line.names, DETAIL_CAP);
    appendDetailLine(td, line.label,
      rest > 0 ? `${shown} ${t('usageMore', String(rest))}` : shown);
  }
  // The complete list with locations and a jump to the object is in the
  // usage view — here are names, there it says where exactly they sit.
  // Views and subsets have no target there (see `usageNode` in the host).
  if (USAGE_LINK_KINDS.has(r.kind)) {
    const div = document.createElement('div');
    div.className = 'bd-dline';
    // Empty heading column, so the link lines up under the names.
    const pad = document.createElement('span');
    pad.className = 'bd-dlabel';
    div.appendChild(pad);
    const link = document.createElement('a');
    link.className = 'bd-usage-link';
    link.href = '#';
    link.textContent = t('usageOpen');
    link.title = t('usageOpenTitle');
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      vscode.postMessage({ type: 'openUsage', kind: r.kind, name: r.name });
    });
    div.appendChild(link);
    td.appendChild(div);
  }
  tr.appendChild(td);
  return tr;
}

/** The building blocks of the row need the state and the draw command of the page. */
const shellDeps = {
  selected, expanded, rerender: (): void => render(),
  text: { t, kindLabel }, matchesPattern, rowKey, rowOwner,
};

function render(): void {
  const list = visibleRows();
  tbody.textContent = '';
  for (const r of list) {
    const info = rowInfo(r);
    // A marked cube lifts the lock on its dimensions — that is why
    // the shared building block redraws on every selection change.
    const { tr, box, open } = buildRowShell(r, shellDeps, info.lines.length > 0);

    const tdStatus = document.createElement('td');
    tdStatus.className = info.locked ? 'bd-status bd-blocked' : 'bd-status';
    tdStatus.textContent = info.status;
    if (info.statusTitle) { tdStatus.title = info.statusTitle; }
    tr.appendChild(tdStatus);
    tr.appendChild(numCell(info.counts.processes));
    tr.appendChild(numCell(info.counts.rules));
    tr.appendChild(numCell(info.counts.chores));
    tr.appendChild(numCell(info.counts.views));
    tr.appendChild(numCell(info.counts.subsets));

    if (box.checked) { tr.className = 'bd-sel'; }
    if (info.locked) { tr.className = tr.className ? tr.className + ' bd-locked' : 'bd-locked'; }

    wireRowClick(tr, box);
    tbody.appendChild(tr);
    if (open && info.lines.length > 0) { tbody.appendChild(detailRow(r, info)); }
  }

  headBox.checked = headBoxChecked(list, selected, rowKey);
  countEl.textContent = t('counts', String(list.length), String(selected.size));
  deleteBtn.disabled = selected.size === 0;
  // What is checked is the SELECTION, not the table: the reference index reads every
  // process, rule and chore text of the server, and someone who wants to delete three objects
  // should not have 800 rows checked.
  usageBtn.disabled = selected.size === 0;
  emptyEl.hidden = list.length > 0 || !searched;
  emptyEl.textContent = t('noRows');

  const notes: string[] = [];
  if (searched && list.length > 0 && selected.size === 0) { notes.push(t('pickRows')); }
  if (failedKinds.length > 0) {
    notes.push(t('kindFailed', failedKinds.map(kindLabel).join(', ')));
  }
  if (incomplete.length > 0) {
    notes.push(t('incompleteWarning', incomplete.join(', ')));
  }
  // "Free" here only means "nothing known was found". A process that sets its
  // data source from a parameter cannot be attributed statically — that
  // belongs in front of a delete decision, not in a comment.
  if (usageLoaded && dynamicDataSources.length > 0) {
    const { shown, rest } = capNames(dynamicDataSources, DETAIL_CAP);
    notes.push(t('dynamicDataSourceWarning',
      rest > 0 ? `${shown} ${t('usageMore', String(rest))}` : shown));
  }
  noteEl.textContent = notes.join('  ');
  noteEl.hidden = notes.length === 0;
}

window.addEventListener('message', (e) => {
  const msg = e.data as HostToWebview;
  // Everything except `init` and `done` belongs to a job. What does not belong to the
  // current generation is the answer to a question nobody is
  // asking any more — including its `busy`, which would otherwise clear the notice of the running
  // job.
  if ('gen' in msg && msg.gen !== gen) { return; }
  switch (msg.type) {
    case 'init':
      l10n = msg.l10n;
      // Only now are the texts available — drawing earlier would mean showing the keys
      // themselves.
      render();
      break;
    case 'rows':
      rows = msg.rows;
      failedKinds = msg.failedKinds;
      usageLoaded = false;
      searched = true;
      incomplete = [];
      dynamicDataSources = [];
      // The collapse state belongs to the old table.
      expanded.clear();
      // Drop the selection: after a reload it is not certain that
      // the marked items still exist.
      selected.clear();
      errorEl.hidden = true;
      render();
      break;
    case 'usage': {
      // Let `rowKey` form the key, do not
      // rebuild it by hand — otherwise its next change silently breaks here. For that
      // the result carries the FULL identifier of its row:
      // without parent object and hierarchy `Sales / Monthly` found no row.
      const byKey = new Map(msg.usage.map(u => [rowKey(u), u.usage]));
      for (const r of rows) { r.usage = byKey.get(rowKey(r)); }
      usageLoaded = true;
      incomplete = msg.incomplete;
      dynamicDataSources = msg.dynamicDataSources;
      render();
      break;
    }
    case 'busy':
      busyEl.hidden = !msg.on;
      busyEl.textContent = msg.label ?? '';
      break;
    case 'error':
      errorEl.hidden = false;
      errorEl.textContent = msg.message;
      break;
    case 'done':
      // The host has already reported; the list is now stale. The same
      // search once more — not the whole server.
      runSearch();
      break;
  }
});

/** Searching means: fetch exactly the checked kinds, filtered as set. */
function runSearch(): void {
  // The checkboxes carry their kind in `data-kind`; the shared building block
  // only knows strings, the message to the host the narrower kind.
  const kinds = [...activeKinds()] as ObjKind[];
  if (kinds.length === 0) { return; }
  // Every search is a new job — whatever is still in flight from the old one
  // should be discarded.
  gen++;
  vscode.postMessage({
    type: 'search', kinds, gen,
    pattern: patternInput.value, includeControl: controlBox.checked,
  });
}

const { syncSearchState } = wireBulkTable({
  selected, rerender: render, visibleRows, rowKey, runSearch,
  headBox, patternInput, controlBox, searchBtn, searchHint,
  allBtn: $('bd-all'), noneBtn: $('bd-none'),
});
// What is checked is the SELECTION — including the rows the filter currently does not
// show: the selection survives a filter change, and what is deleted
// should be checked.
usageBtn.addEventListener('click', () => {
  const picked = rows.filter(r => selected.has(rowKey(r)));
  if (picked.length === 0) { return; }
  vscode.postMessage({
    // The SAME generation as the table: a new search thereby makes this
    // check invalid automatically.
    type: 'analyze', gen,
    rows: picked.map(r => ({ kind: r.kind, name: r.name, parent: r.parent, hierarchy: r.hierarchy })),
  });
});
deleteBtn.addEventListener('click', () => {
  const items = rows.filter(r => selected.has(rowKey(r)))
    .map(r => ({ kind: r.kind, name: r.name, parent: r.parent, hierarchy: r.hierarchy }));
  if (items.length === 0) { return; }
  vscode.postMessage({ type: 'delete', items, gen });
});

syncSearchState();
vscode.postMessage({ type: 'ready' });
