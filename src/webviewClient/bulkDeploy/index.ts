// src/webviewClient/bulkDeploy/index.ts
// Bundle of the bulk migration page. Holds the selection, filters the rows and
// computes the list of missing items against the CURRENT selection: what goes along
// in the same run is not missing (see `bulkDeployPure#openMissing`).
import { matchesPattern, capNames, rowKey, rowOwner, rowLabel } from '../../webviews/bulkObjectsPure';
import { openMissing, type DeployKind, type MissingRef } from '../../webviews/bulkDeployPure';
import type { L10nMap } from '../_shared/l10n';
import {
  activeKinds, appendDetailLine, buildDetailShell, buildRowShell, bulkText,
  headBoxChecked, wireBulkTable, wireRowClick,
} from '../_shared/bulkTable';
import type { DeployRow, HostToWebview, TargetOption, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost>();

let l10n: L10nMap = {};
let rows: DeployRow[] = [];
/** Keys of the checked rows — survives a filter change. */
const selected = new Set<string>();
let failedKinds: DeployKind[] = [];
let checked = false;
let incomplete: string[] = [];
let inventoryFailed: string[] = [];
let searched = false;
let gen = 0;

const $ = (id: string) => document.getElementById(id)!;
const tbody = $('bd-tbody');
const patternInput = $('bd-pattern') as HTMLInputElement;
const controlBox = $('bd-control') as HTMLInputElement;
const headBox = $('bd-head-box') as HTMLInputElement;
const targetSelect = $('bd-target') as HTMLSelectElement;
const countEl = $('bd-count');
const busyEl = $('bd-busy');
const noteEl = $('bd-note');
const errorEl = $('bd-error');
const emptyEl = $('bd-empty');
const deployBtn = $('bd-deploy') as HTMLButtonElement;
const searchBtn = $('bd-search') as HTMLButtonElement;
const checkBtn = $('bd-check') as HTMLButtonElement;
const searchHint = $('bd-search-hint');
const diffOnlyBox = $('bd-diff-only') as HTMLInputElement;

/** How many names fit into the expanded row. */
const DETAIL_CAP = 30;

/** Which rows are expanded — survives a redraw. */
const expanded = new Set<string>();

const { t, kindLabel } = bulkText(() => l10n);

const asRef = (r: DeployRow) =>
  ({ kind: r.kind, name: r.name, parent: r.parent, hierarchy: r.hierarchy });

function visibleRows(): DeployRow[] {
  const kinds = activeKinds();
  const pattern = patternInput.value;
  const withControl = controlBox.checked;
  // "Only differences" hides what is the same over there — new objects and
  // unchecked rows stay, they are not known to be the same.
  const diffOnly = diffOnlyBox.checked;
  return rows.filter(r =>
    kinds.has(r.kind) && (withControl || !r.isControl) && matchesPattern(r.name, pattern)
    && !(diffOnly && r.check?.content?.status === 'same'));
}

/**
 * What a row says about the target.
 *
 * Two questions, two columns: `target` answers "is anything lost over
 * there?", `missing` answers "does it run over there at all?". The names
 * are in the expanded row.
 */
interface RowInfo {
  target: string;
  overwrite: boolean;
  missing: MissingRef[];
  missingText: string;
  unresolved: boolean;
}

function rowInfo(r: DeployRow): RowInfo {
  if (!checked || !r.check) {
    return {
      target: t('targetIdle'), overwrite: false, missing: [], missingText: '', unresolved: false,
    };
  }
  // What goes along in the same run is not missing: processes come before chores, and
  // a co-marked process is over there before its chore is written.
  const open = openMissing(r.check, selected);
  const unresolved = r.check.unresolved > 0;
  const missingText = open.length > 0
    ? t('missingCount', String(open.length))
    : (unresolved || incomplete.length > 0 ? t('missingUnknown') : t('missingNone'));
  return {
    target: r.check.exists ? t('targetOverwrite') : t('targetNew'),
    overwrite: r.check.exists,
    missing: open,
    missingText,
    unresolved,
  };
}

/**
 * The content cell: same / differs in which parts / unreadable. A difference
 * is a link that opens the diff editor.
 */
function contentCell(r: DeployRow): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'bd-status';
  const c = r.check?.content;
  if (!c) { return td; }
  if (c.status === 'error') {
    td.classList.add('bd-blocked');
    td.textContent = t('contentError');
    td.title = c.reason ?? '';
    return td;
  }
  const expected = c.expected.length > 0 ? t('contentExpected', c.expected.join(', ')) : '';
  if (c.status === 'same') {
    td.textContent = t('contentSame');
    td.title = expected;
    return td;
  }
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = c.parts.join(', ');
  a.title = [t('contentOpenDiff'), expected].filter(Boolean).join('\n');
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    // The row click toggles the selection — opening a diff must not.
    ev.stopPropagation();
    vscode.postMessage({ type: 'diff', gen, targetId: targetSelect.value, ref: asRef(r) });
  });
  td.classList.add('bd-blocked');
  td.appendChild(a);
  return td;
}

/** The expanded row: the names of what is missing over there. */
function detailRow(info: RowInfo): HTMLTableRowElement {
  const { tr, td } = buildDetailShell(5);
  const names = info.missing.map(m => `${kindLabel(m.kind)} ${rowLabel(m)}`);
  const { shown, rest } = capNames(names, DETAIL_CAP);
  appendDetailLine(td, t('detailMissing'),
    rest > 0 ? `${shown} ${t('usageMore', String(rest))}` : shown);
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
    // A co-marked process removes the missing item from its chore — that is why
    // the shared building block redraws on every selection change.
    const { tr, box, open } = buildRowShell(r, shellDeps, info.missing.length > 0);

    const tdTarget = document.createElement('td');
    tdTarget.className = info.overwrite ? 'bd-status bd-blocked' : 'bd-status';
    tdTarget.textContent = info.target;
    tr.appendChild(tdTarget);

    const tdMissing = document.createElement('td');
    tdMissing.className = info.missing.length > 0 ? 'bd-status bd-blocked' : 'bd-status';
    tdMissing.textContent = info.missingText;
    if (info.missing.length > 0) {
      tdMissing.title = info.missing.map(m => `${kindLabel(m.kind)} ${rowLabel(m)}`).join(', ');
    }
    tr.appendChild(tdMissing);
    tr.appendChild(contentCell(r));

    if (box.checked) { tr.className = 'bd-sel'; }
    if (info.missing.length > 0) {
      tr.className = tr.className ? tr.className + ' bd-locked' : 'bd-locked';
    }

    wireRowClick(tr, box);
    tbody.appendChild(tr);
    if (open && info.missing.length > 0) { tbody.appendChild(detailRow(info)); }
  }

  headBox.checked = headBoxChecked(list, selected, rowKey);
  countEl.textContent = t('counts', String(list.length), String(selected.size));
  const noTarget = targetSelect.value === '';
  deployBtn.disabled = selected.size === 0 || noTarget;
  // What is checked is the SELECTION: with no selection there is nothing to check, and with a
  // selection the check costs only what is to be transferred.
  checkBtn.disabled = selected.size === 0 || noTarget;
  emptyEl.hidden = list.length > 0 || !searched;
  emptyEl.textContent = t('noRows');

  const notes: string[] = [];
  if (noTarget) { notes.push(t('pickTarget')); }
  if (searched && list.length > 0 && selected.size === 0) { notes.push(t('pickRows')); }
  if (failedKinds.length > 0) { notes.push(t('kindFailed', failedKinds.map(kindLabel).join(', '))); }
  if (incomplete.length > 0) { notes.push(t('incompleteWarning', incomplete.join(', '))); }
  if (inventoryFailed.length > 0) {
    notes.push(t('inventoryWarning', inventoryFailed.join(', ')));
  }
  if (checked) {
    notes.push(t('inSelectionNote'));
    if (rows.some(r => (r.check?.unresolved ?? 0) > 0)) { notes.push(t('unresolvedWarning')); }
  }
  noteEl.textContent = notes.join('  ');
  noteEl.hidden = notes.length === 0;
}

function fillTargets(targets: TargetOption[]): void {
  // The previous choice survives a reload — otherwise after every
  // press of ↻ the first server would be selected, and the finding next to it would belong to a
  // different one.
  const previous = targetSelect.value;
  targetSelect.textContent = '';
  if (targets.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = t('targetNone');
    targetSelect.appendChild(opt);
    targetSelect.disabled = true;
    return;
  }
  for (const target of targets) {
    const opt = document.createElement('option');
    opt.value = target.id;
    opt.textContent = target.label;
    opt.title = target.url;
    targetSelect.appendChild(opt);
  }
  targetSelect.disabled = false;
  if (previous && targets.some(target => target.id === previous)) {
    targetSelect.value = previous;
    return;
  }
  // The previous target is gone (disconnected) or there was none: what was checked
  // belongs to a server that is no longer listed here.
  if (previous) { dropChecks(); }
}

/**
 * Discard findings — they always apply to exactly ONE target.
 *
 * The generation keeps counting: a check still running against the
 * old target would otherwise reply with a valid generation and put its finding
 * into the table, which now shows a different target — "overwrites"
 * on the wrong server. With the new generation the late
 * reply is dropped; the same goes for its `busy: false`, which is why the
 * switch clears the display itself.
 */
function dropChecks(): void {
  checked = false;
  for (const r of rows) { r.check = undefined; }
  expanded.clear();
  gen++;
  busyEl.hidden = true;
}

window.addEventListener('message', (e) => {
  const msg = e.data as HostToWebview;
  if ('gen' in msg && msg.gen !== gen) { return; }
  switch (msg.type) {
    case 'init':
      l10n = msg.l10n;
      fillTargets(msg.targets);
      render();
      break;
    case 'targets':
      fillTargets(msg.targets);
      render();
      break;
    case 'rows':
      rows = msg.rows;
      failedKinds = msg.failedKinds;
      checked = false;
      searched = true;
      incomplete = [];
      inventoryFailed = [];
      expanded.clear();
      // Drop the selection: after a reload it is not certain that
      // the marked items still exist.
      selected.clear();
      errorEl.hidden = true;
      render();
      break;
    case 'checks': {
      const byKey = new Map(msg.checks.map(c => [rowKey(c), c.check]));
      for (const r of rows) { r.check = byKey.get(rowKey(r)); }
      checked = true;
      incomplete = msg.incomplete;
      inventoryFailed = msg.inventoryFailed;
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
    case 'done': {
      // Do NOT search again. The search lists the SOURCE, and that has not
      // changed — a full server fetch for nothing, and the `rows` handler
      // discards selection and findings in the process. The user then no longer saw
      // what they had just transferred.
      //
      // What really changed is in the results: what was
      // written now exists over there. Exactly that is written into the
      // rows — "new" becomes "overwrites".
      const written = new Set(
        msg.outcomes.filter(o => o.ok && !o.skipped).map(o => rowKey(o)));
      for (const r of rows) {
        // The comparison described the state before the write — drop it.
        if (r.check && written.has(rowKey(r))) {
          r.check = { ...r.check, exists: true, content: undefined };
        }
      }
      render();
      break;
    }
  }
});

function runSearch(): void {
  // The checkboxes carry their kind in `data-kind`; the shared building block
  // only knows strings, the message to the host the narrower kind.
  const kinds = [...activeKinds()] as DeployKind[];
  if (kinds.length === 0) { return; }
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
// A different target means: the finding belongs to the old one. Leaving it standing
// would be the most dangerous display on the page — "overwrites" on the wrong
// server.
targetSelect.addEventListener('change', () => {
  dropChecks();
  render();
});
diffOnlyBox.addEventListener('change', () => render());
$('bd-target-refresh').addEventListener('click', () => {
  vscode.postMessage({ type: 'targets' });
});
checkBtn.addEventListener('click', () => {
  // Exactly the checked rows — including those the filter currently does not
  // show: the selection survives a filter change, and what is transferred
  // should be checked.
  const picked = rows.filter(r => selected.has(rowKey(r)));
  if (picked.length === 0 || targetSelect.value === '') { return; }
  // New job, new generation: the previous check may have run over
  // a different selection and must not deliver its findings late.
  gen++;
  vscode.postMessage({
    type: 'check', gen, targetId: targetSelect.value, rows: picked.map(asRef),
  });
});
deployBtn.addEventListener('click', () => {
  const items = rows.filter(r => selected.has(rowKey(r))).map(asRef);
  if (items.length === 0 || targetSelect.value === '') { return; }
  vscode.postMessage({ type: 'deploy', items, gen, targetId: targetSelect.value });
});

syncSearchState();
vscode.postMessage({ type: 'ready' });
