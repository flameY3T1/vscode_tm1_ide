/**
 * Chore Editor webview client.
 *
 * Bundled by esbuild from `src/webviewClient/choreEditor/index.ts` →
 * `out/webview/choreEditor.js` and loaded by
 * `src/commands/chore/choreEditorWebview.ts`.
 *
 * Post-H17 #7 split (2026-05-18): inline `<script>` in choreEditorWebview.ts
 * (lines 312–744) moved here. Behavior identical, code paths unchanged.
 */

import { getL10n, fmt } from '../_shared/l10n';
import { tryGetVsCodeApi } from '../_shared/vscodeApi';
import { attachTitleCombo, closeTitleCombo } from '../_shared/filterCombo';
import type { HostToWebview, WebviewToHost } from './protocol';
import {
  applyParamInput,
  buildSaveTasks,
  failedParamProcesses,
  findInvalidNumericParams,
  formatFrequency,
  mergeParamInputs,
  parseFrequency,
  pendingParamProcesses,
  type ClientTask,
  type FrequencyState,
  type ParamInput,
  type ParamsCache,
} from './statePure';


const L = getL10n();

type TaskRow = ClientTask;
type IncomingMsg = HostToWebview;

const vscode = tryGetVsCodeApi<WebviewToHost>();

let isNew = false;
let originalName = '';
let processList: string[] = [];
const processParamsCache: ParamsCache = {};
let tasks: TaskRow[] = [];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`Element not found: ${id}`); }
  return el;
}
function $i(id: string): HTMLInputElement { return $(id) as HTMLInputElement; }
function $s(id: string): HTMLSelectElement { return $(id) as HTMLSelectElement; }
function $b(id: string): HTMLButtonElement { return $(id) as HTMLButtonElement; }

// ── Frequency helpers ─────────────────────────────────────────────────────
// `rawFrequency` holds a server value the controls cannot represent (every 5
// minutes, every 3 hours, …). It is returned verbatim on save so an untouched
// chore keeps its schedule instead of collapsing to "daily"; any interaction
// with the frequency controls clears it.
let rawFrequency: string | null = null;

function setFrequency(freq: string | null | undefined): void {
  const state = parseFrequency(freq);
  rawFrequency = state.raw;
  $s('f-freq').value = state.preset;
  const isDays = state.preset === 'days';
  // Leave the days field at its markup default unless it is actually in use.
  if (isDays) { $i('f-freq-days').value = state.days; }
  $('f-freq-days-wrap').style.display = isDays ? 'flex' : 'none';
}

function getFrequency(): string {
  const state: FrequencyState = {
    preset: $s('f-freq').value,
    days: $i('f-freq-days').value,
    raw: rawFrequency,
  };
  return formatFrequency(state);
}

$s('f-freq').addEventListener('change', function () {
  rawFrequency = null;
  const wrap = $('f-freq-days-wrap');
  wrap.style.display = (this as HTMLSelectElement).value === 'days' ? 'flex' : 'none';
});

$i('f-freq-days').addEventListener('input', function () { rawFrequency = null; });

// ── ExecutionMode helpers ─────────────────────────────────────────────────
// The server does not always report `ExecutionMode`: on a TM1 that rejects it in
// `$select`, the chore-detail fallback ladder drops it and 11.8 answers without
// the key. Showing "Multiple commit" for that would be a lie AND would write the
// lie back on the next save, downgrading a SingleCommit chore's transaction
// semantics. So an unknown mode gets its own, selected option; picking a real
// mode removes it again, and an unsent (empty) value leaves the field out of the
// payload entirely.
const EXEC_UNKNOWN_OPTION_ID = 'f-execmode-unknown';

function dropUnknownExecModeOption(): void {
  const opt = document.getElementById(EXEC_UNKNOWN_OPTION_ID);
  if (opt && opt.parentNode) { opt.parentNode.removeChild(opt); }
}

function setExecutionMode(mode: string | null | undefined): void {
  const sel = $s('f-execmode');
  dropUnknownExecModeOption();
  if (mode === 'SingleCommit' || mode === 'MultipleCommit') {
    sel.value = mode;
    return;
  }
  const opt = document.createElement('option');
  opt.id = EXEC_UNKNOWN_OPTION_ID;
  opt.value = '';
  opt.textContent = L.execModeUnknown;
  sel.insertBefore(opt, sel.firstChild);
  sel.value = '';
}

/** '' = unknown → the caller omits `ExecutionMode` from the payload. */
function getExecutionMode(): 'SingleCommit' | 'MultipleCommit' | undefined {
  const v = $s('f-execmode').value;
  return v === 'SingleCommit' || v === 'MultipleCommit' ? v : undefined;
}

$s('f-execmode').addEventListener('change', function () {
  // Once a real mode is chosen the chore HAS a known mode — and it gets written.
  if ((this as HTMLSelectElement).value) { dropUnknownExecModeOption(); }
});

// ── StartTime helpers ─────────────────────────────────────────────────────
function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

function todayIso(): string {
  const d = new Date();
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

// StartTime is entered/shown as UTC. TM1 normalizes any StartTime to its own
// standard offset (e.g. +01:00) but preserves the absolute instant, and — with
// DSTSensitive=false — fires at that fixed instant. UTC is the only representation
// that survives TM1's normalization and DST unchanged, so the field round-trips
// exactly (`…Z` in ↔ `…+01:00` stored = same instant). We parse the stored value
// to its UTC instant for display and always write a `Z` value back. Verified live
// against TM1 11.8: PATCH `18:30:00Z` → stored `19:30+01:00` (same instant).
function setStartTime(startTime: string | null | undefined): void {
  let h = 0, m = 0, datePart = '';
  if (startTime) {
    const mm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/.exec(startTime);
    if (mm) {
      let offMin = 0;
      const tz = mm[7];
      if (tz && tz !== 'Z') {
        const sign = tz.charAt(0) === '-' ? -1 : 1;
        offMin = sign * (parseInt(tz.slice(1, 3), 10) * 60 + parseInt(tz.slice(4, 6), 10));
      }
      const utc = new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +mm[4], +mm[5], mm[6] ? +mm[6] : 0) - offMin * 60000);
      datePart = utc.getUTCFullYear() + '-' + pad2(utc.getUTCMonth() + 1) + '-' + pad2(utc.getUTCDate());
      h = utc.getUTCHours();
      m = utc.getUTCMinutes();
    }
  }
  $i('f-date').value = /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : todayIso();
  $i('f-hour').value = pad2(Math.max(0, Math.min(23, h)));
  $i('f-minute').value = pad2(Math.max(0, Math.min(59, m)));
}

function getStartTime(): string {
  const dateVal = $i('f-date').value;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? dateVal : todayIso();
  let h = parseInt($i('f-hour').value || '0', 10);
  let m = parseInt($i('f-minute').value || '0', 10);
  h = Math.max(0, Math.min(23, isNaN(h) ? 0 : h));
  m = Math.max(0, Math.min(59, isNaN(m) ? 0 : m));
  return date + 'T' + pad2(h) + ':' + pad2(m) + ':00Z';
}

$i('f-hour').addEventListener('blur', function () {
  const v = parseInt((this as HTMLInputElement).value || '0', 10);
  (this as HTMLInputElement).value = pad2(Math.max(0, Math.min(23, isNaN(v) ? 0 : v)));
});
$i('f-minute').addEventListener('blur', function () {
  const v = parseInt((this as HTMLInputElement).value || '0', 10);
  (this as HTMLInputElement).value = pad2(Math.max(0, Math.min(59, isNaN(v) ? 0 : v)));
});

// ── Process params on-demand ──────────────────────────────────────────────
function requestProcessParams(procName: string): void {
  const key = procName.toLowerCase();
  const cached = processParamsCache[key];
  // Only a resolved definition or a request in flight is a reason not to ask.
  // A FAILED fetch stays retryable — treating it as "done" is what let the
  // editor report "ready" while every parameter type was unknown.
  if (cached === 'loading' || Array.isArray(cached)) { return; }
  processParamsCache[key] = 'loading';
  if (vscode) { vscode.postMessage({ type: 'getProcessParams', processName: procName }); }
}

// ── Tasks rendering ───────────────────────────────────────────────────────
function renderTasks(): void {
  closeTitleCombo();
  const container = $('tasks-container');
  container.innerHTML = '';
  for (let i = 0; i < tasks.length; i++) {
    container.appendChild(buildTaskCard(i));
  }
}

function buildTaskCard(idx: number): HTMLElement {
  const task = tasks[idx];
  const card = document.createElement('div');
  card.className = 'task-card';
  card.setAttribute('data-idx', String(idx));

  const hdr = document.createElement('div');
  hdr.className = 'task-card-header';

  const stepLabel = document.createElement('span');
  stepLabel.className = 'task-step-label';
  stepLabel.textContent = fmt(L, 'taskN', idx + 1);

  const procSel = document.createElement('select');
  procSel.className = 'task-process-select';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = L.chooseProcess;
  procSel.appendChild(emptyOpt);
  for (let pi = 0; pi < processList.length; pi++) {
    const opt = document.createElement('option');
    opt.value = processList[pi];
    opt.textContent = processList[pi];
    if (processList[pi] === task.processName) { opt.selected = true; }
    procSel.appendChild(opt);
  }
  procSel.setAttribute('data-idx', String(idx));
  procSel.addEventListener('change', onProcessChange);

  const btnUp = document.createElement('button');
  btnUp.className = 'task-btn'; btnUp.title = L.moveUp; btnUp.textContent = '↑';
  btnUp.setAttribute('data-idx', String(idx)); btnUp.addEventListener('click', onTaskMoveUp);
  if (idx === 0) { btnUp.disabled = true; btnUp.style.opacity = '0.3'; }

  const btnDown = document.createElement('button');
  btnDown.className = 'task-btn'; btnDown.title = L.moveDown; btnDown.textContent = '↓';
  btnDown.setAttribute('data-idx', String(idx)); btnDown.addEventListener('click', onTaskMoveDown);
  if (idx === tasks.length - 1) { btnDown.disabled = true; btnDown.style.opacity = '0.3'; }

  const btnDel = document.createElement('button');
  btnDel.className = 'task-btn danger'; btnDel.title = L.removeTask; btnDel.textContent = '✕';
  btnDel.setAttribute('data-idx', String(idx)); btnDel.addEventListener('click', onTaskRemove);

  // Servers carry hundreds of processes: filterable list on top of the select (filterCombo.ts).
  hdr.appendChild(stepLabel); hdr.appendChild(procSel);
  hdr.appendChild(attachTitleCombo(procSel, '', undefined, { byLabel: true }));
  hdr.appendChild(btnUp); hdr.appendChild(btnDown); hdr.appendChild(btnDel);
  card.appendChild(hdr);

  const paramsDiv = document.createElement('div');
  paramsDiv.className = 'task-params';
  paramsDiv.appendChild(buildParamsTable(idx));
  card.appendChild(paramsDiv);

  return card;
}

function buildParamsTable(idx: number): HTMLElement {
  const task = tasks[idx];
  if (!task.processName) {
    const p = document.createElement('div');
    p.className = 'no-params';
    p.textContent = L.noProcessChosen;
    return p;
  }

  const cached = processParamsCache[task.processName.toLowerCase()];

  if (cached === 'error') {
    // Not "no parameters" — the definition could not be fetched. Saving is
    // refused while this stands (`failedParamProcesses`).
    const p = document.createElement('div');
    p.className = 'no-params';
    p.textContent = L.paramsLoadError;
    return p;
  }

  if (cached === 'loading' || cached === undefined) {
    const p = document.createElement('div');
    p.className = 'no-params';
    p.textContent = L.loadingParams;
    return p;
  }

  if (!cached || cached.length === 0) {
    const p = document.createElement('div');
    p.className = 'no-params';
    p.textContent = L.noParams;
    return p;
  }

  const knownParams = cached;
  const tbl = document.createElement('table');
  tbl.className = 'params-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>' + L.colParameter + '</th><th>' + L.colType + '</th><th>' + L.colValue + '</th></tr>';
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let pi = 0; pi < knownParams.length; pi++) {
    const kp = knownParams[pi];
    let existingVal = kp.value;
    for (let ei = 0; ei < task.params.length; ei++) {
      if (task.params[ei].name.toLowerCase() === kp.name.toLowerCase()) {
        existingVal = task.params[ei].value;
        break;
      }
    }
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = kp.name;
    const tdType = document.createElement('td');
    tdType.className = 'type-cell';
    tdType.textContent = kp.type;
    const tdVal = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = existingVal || '';
    inp.setAttribute('data-task-idx', String(idx));
    inp.setAttribute('data-param', kp.name);
    inp.setAttribute('data-type', kp.type);
    inp.addEventListener('input', onParamChange);
    tdVal.appendChild(inp);
    tr.appendChild(tdName); tr.appendChild(tdType); tr.appendChild(tdVal);
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  return tbl;
}

function onProcessChange(e: Event): void {
  const target = e.target as HTMLSelectElement;
  const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
  const newProc = target.value;
  tasks[idx].processName = newProc;
  tasks[idx].params = [];
  if (newProc) { requestProcessParams(newProc); }
  renderTasks();
}

/** Read one rendered parameter input into a plain snapshot. */
function readParamInput(inp: HTMLInputElement): ParamInput {
  return {
    taskIdx: parseInt(inp.getAttribute('data-task-idx') || '0', 10),
    name: inp.getAttribute('data-param') || '',
    // `data-type` comes from the process definition and is authoritative.
    type: inp.getAttribute('data-type') || '',
    value: inp.value,
  };
}

function onParamChange(e: Event): void {
  applyParamInput(tasks, readParamInput(e.target as HTMLInputElement));
}

function onTaskMoveUp(e: Event): void {
  const target = e.target as HTMLElement;
  const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
  if (idx <= 0) { return; }
  const tmp = tasks[idx - 1]; tasks[idx - 1] = tasks[idx]; tasks[idx] = tmp;
  renderTasks();
}

function onTaskMoveDown(e: Event): void {
  const target = e.target as HTMLElement;
  const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
  if (idx >= tasks.length - 1) { return; }
  const tmp = tasks[idx + 1]; tasks[idx + 1] = tasks[idx]; tasks[idx] = tmp;
  renderTasks();
}

function onTaskRemove(e: Event): void {
  const target = e.target as HTMLElement;
  const idx = parseInt(target.getAttribute('data-idx') || '0', 10);
  tasks.splice(idx, 1);
  renderTasks();
}

$('btn-add-task').addEventListener('click', function () {
  tasks.push({ processName: '', params: [] });
  renderTasks();
  (document.querySelector('.editor-body') as HTMLElement).scrollTop = 99999;
});

// ── Validation ────────────────────────────────────────────────────────────
function showError(msg: string): void {
  const banner = $('validation-banner');
  banner.textContent = msg;
  banner.style.display = msg ? 'block' : 'none';
}

function validate(): boolean {
  const name = $i('f-name').value.trim();
  if (!name) { showError(L.nameRequired); return false; }
  for (let i = 0; i < tasks.length; i++) {
    if (!tasks[i].processName) {
      showError(fmt(L, 'taskNoProcess', i + 1));
      return false;
    }
  }
  showError('');
  return true;
}

function collectParamsFromDom(): void {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[data-task-idx]');
  const snapshots: ParamInput[] = [];
  for (let ii = 0; ii < inputs.length; ii++) { snapshots.push(readParamInput(inputs[ii])); }
  mergeParamInputs(tasks, snapshots);
}

// ── Save / Save as / Cancel / Run ─────────────────────────────────────────
/**
 * True between posting a save/saveAs and the extension's answer.
 *
 * Both save paths run deactivate → DELETE every task → PATCH the new list. Two
 * overlapping runs would let the second clear delete what the first had just
 * written, so only one may be in flight. This is the convenience half of the
 * guard (a webview can be reloaded, and messages can be posted from anywhere) —
 * the authoritative lock is the per-panel one in `choreEditor.ts`.
 */
let saveInFlight = false;

function setSaveInFlight(on: boolean): void {
  saveInFlight = on;
  $b('btn-save').disabled = on;
  // These two are additionally disabled while the chore has never been saved.
  $b('btn-run').disabled = on || isNew;
  $b('btn-save-as').disabled = on || isNew;
}

/**
 * Collect + validate the form and post it to the extension.
 *
 * `outType` picks the receiving branch: 'save' writes back to the open chore,
 * 'saveAs' copies it to a new name (the extension prompts for that name — a
 * webview cannot, `window.prompt` is blocked). Both paths run the SAME guards:
 * a copy must not be built from half-loaded parameter types either.
 */
function buildAndSend(outType: 'save' | 'saveAs', thenExecute: boolean): void {
  // A second click while the first save is still running would start a second
  // clear→PATCH sequence on the same chore.
  if (saveInFlight) { return; }
  if (!validate()) { return; }
  // The parameter rows carry the authoritative type from the process definition.
  // Saving before they have arrived would send parameters that never got that
  // correction — a numeric would go out as a string and TM1 would reject it.
  const pending = pendingParamProcesses(tasks, processParamsCache);
  if (pending.length > 0) {
    showError(fmt(L, 'paramsStillLoading', pending.join(', ')));
    return;
  }
  // A definition that could NOT be fetched is not an empty definition. Saving
  // on one would send the chore's own parameter list with unknown types — a
  // numeric as a string, no process defaults — which TM1 rejects only AFTER the
  // tasks were deleted.
  const failed = failedParamProcesses(tasks, processParamsCache);
  if (failed.length > 0) {
    showError(fmt(L, 'paramsLoadFailed', failed.join(', ')));
    return;
  }
  collectParamsFromDom();
  // A numeric parameter holding text would not reach the server as typed:
  // coerceChoreParamValue falls back to the process default (or 0), so the save
  // would report success while quietly writing something else. Refuse instead.
  const invalid = findInvalidNumericParams(tasks);
  if (invalid.length > 0) {
    const bad = invalid[0];
    showError(fmt(L, 'paramNotNumeric', bad.taskIdx + 1, bad.name, bad.value));
    return;
  }
  const choreData = {
    Name: $i('f-name').value.trim(),
    Active: $i('f-active').checked,
    DST: $i('f-dst').checked,
    // `undefined` when the server never reported the mode — the field is then
    // left out of the payload so the chore keeps whatever it has.
    ExecutionMode: getExecutionMode(),
    StartTime: getStartTime(),
    Frequency: getFrequency(),
    // The process definition supplies the parameter LIST, the types and the
    // defaults an empty Numeric field falls back to (TM1 rejects a string/""
    // for a numeric param, and any parameter-count mismatch).
    Tasks: buildSaveTasks(tasks, processParamsCache),
  };
  if (!vscode) { return; }
  setSaveInFlight(true);
  if (outType === 'saveAs') {
    vscode.postMessage({ type: 'saveAs', originalName: originalName, choreData: choreData });
    return;
  }
  vscode.postMessage({ type: 'save', isNew: isNew, originalName: originalName, choreData: choreData, thenExecute: !!thenExecute });
}

$('btn-save').addEventListener('click', function () { buildAndSend('save', false); });
$('btn-save-as').addEventListener('click', function () { buildAndSend('saveAs', false); });
$('btn-run').addEventListener('click', function () { buildAndSend('save', true); });

$('btn-cancel').addEventListener('click', function () {
  if (vscode) { vscode.postMessage({ type: 'cancel' }); }
});

// ── Messages from extension ───────────────────────────────────────────────
window.addEventListener('message', function (e) {
  const msg = e.data as IncomingMsg;

  if (msg.type === 'processParams') {
    const m = msg as Extract<IncomingMsg, { type: 'processParams' }>;
    // A failed fetch is cached as 'error', never as an empty definition.
    processParamsCache[m.processName.toLowerCase()] = m.error ? 'error' : (m.params || []);
    renderTasks();
    return;
  }

  if (msg.type === 'saveError') {
    const m = msg as Extract<IncomingMsg, { type: 'saveError' }>;
    showError(fmt(L, 'errorPrefix', m.message));
    setSaveInFlight(false);
    return;
  }

  if (msg.type === 'saveBusy') {
    // The host refused a second, overlapping save. The FIRST one is still
    // running, so the buttons stay disabled.
    const m = msg as Extract<IncomingMsg, { type: 'saveBusy' }>;
    showError(fmt(L, 'errorPrefix', m.message));
    return;
  }

  if (msg.type === 'saveCancelled') {
    showError(L.saveCancelled);
    setSaveInFlight(false);
    return;
  }

  if (msg.type === 'saveAsSuccess') {
    // The copy opens in its own panel; this one just goes back to editable.
    showError('');
    setSaveInFlight(false);
    return;
  }

  if (msg.type === 'saveSuccess') {
    const m = msg as Extract<IncomingMsg, { type: 'saveSuccess' }>;
    showError('');
    if (m.wasNew) {
      isNew = false;
      originalName = m.choreName;
      $('toolbar-title').textContent = fmt(L, 'choreTitle', originalName);
      const nameInp = $i('f-name');
      nameInp.classList.add('readonly-name');
      nameInp.readOnly = true;
      nameInp.title = L.nameReadonly;
      // The chore now exists on the server, so there is something to run/copy —
      // `setSaveInFlight` re-enables both now that `isNew` is false.
    }
    setSaveInFlight(false);
    return;
  }

  if (msg.type !== 'initData') { return; }

  const initMsg = msg as Extract<IncomingMsg, { type: 'initData' }>;
  isNew = !!initMsg.isNew;
  processList = (initMsg.processNames || []).slice().sort(function (a, b) {
    const aSystem = a.charAt(0) === '}';
    const bSystem = b.charAt(0) === '}';
    if (aSystem !== bSystem) { return aSystem ? 1 : -1; }
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  const nameInput = $i('f-name');
  if (initMsg.chore) {
    const c = initMsg.chore;
    originalName = c.Name;
    nameInput.value = c.Name;
    if (!isNew) {
      nameInput.classList.add('readonly-name');
      nameInput.readOnly = true;
      nameInput.title = L.nameReadonly;
    }
    $i('f-active').checked = !!c.Active;
    $i('f-dst').checked = !!c.DST;
    setExecutionMode(c.ExecutionMode);
    setStartTime(c.StartTime);
    setFrequency(c.Frequency);
    tasks = (c.Tasks || []).map(function (t) {
      return {
        processName: t.processName || '',
        params: (t.Parameters || []).map(function (p) {
          // '' = type unknown. TM1 often omits it on a chore task parameter; the
          // rendered row then supplies it from the process definition. Do NOT
          // guess 'String' here — that is what broke numeric parameters.
          return { name: p.Name, type: p.Type || '', value: p.Value || '' };
        }),
      };
    });
    for (let ti = 0; ti < tasks.length; ti++) {
      if (tasks[ti].processName) { requestProcessParams(tasks[ti].processName); }
    }
  } else {
    originalName = '';
    nameInput.value = '';
    $i('f-active').checked = false;
    $i('f-dst').checked = false;
    // A chore being created has a mode because the editor picks one.
    setExecutionMode('MultipleCommit');
    setStartTime(null);
    setFrequency('P1DT00H00M00S');
    tasks = [];
  }

  $('toolbar-title').textContent = isNew ? L.newChore : fmt(L, 'choreTitle', originalName);
  // Enables Save and — unless the chore is new, which has no server-side
  // original to run or copy from — Run and "Save as" too.
  setSaveInFlight(false);
  renderTasks();
  $('loading').style.display = 'none';
  const main = $('main');
  main.style.display = 'flex';
  main.style.flexDirection = 'column';
  main.style.height = '100%';
});
