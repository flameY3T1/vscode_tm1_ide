// src/webviewClient/newProcess/index.ts
// Bundle of the "New Process" wizard. Until 2026-10 this was an inline script
// in the host's template literal, invisible to tsc and eslint.
import type { HostToWebview, NewProcessBootstrap, WebviewToHost, WizardFinish, WizardParam, WizardVar } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';
import { escapeHtml as esc } from '../htmlUtils';

const vscode = getVsCodeApi<WebviewToHost>();
const { texts: T } = (window as unknown as { __newProcess: NewProcessBootstrap }).__newProcess;

const byId = <E extends HTMLElement = HTMLElement>(id: string): E | null => document.getElementById(id) as E | null;
const must = <E extends HTMLElement = HTMLElement>(id: string): E => document.getElementById(id) as E;

let currentStep = 1;
const totalSteps = 4;
// The template step exists only when the host rendered templates.
const MIN_STEP = byId('step0') ? 0 : 1;
let selectedTemplateId = '';

function selectTpl(el: Element): void {
  document.querySelectorAll('#tplList .tpl-item').forEach((i) => i.classList.remove('selected'));
  el.classList.add('selected');
  selectedTemplateId = el.getAttribute('data-id') || '';
}

// ------- Step navigation -------
function showStep(n: number): void {
  const s0 = byId('step0');
  if (s0) { s0.style.display = n === 0 ? 'block' : 'none'; }
  const sb0 = byId('sb0');
  if (sb0) { sb0.className = 's' + (n === 0 ? ' active' : (n > 0 ? ' done' : '')); }
  for (let i = 1; i <= totalSteps; i++) {
    const el = byId('step' + i);
    if (el) { el.style.display = i === n ? 'block' : 'none'; }
    const sb = byId('sb' + i);
    if (sb) { sb.className = 's' + (i === n ? ' active' : (i < n ? ' done' : '')); }
  }
  must('btnBack').style.display = n > MIN_STEP ? '' : 'none';
  must('btnNext').style.display = n < totalSteps ? '' : 'none';
  must('btnCreate').style.display = n === totalSteps ? '' : 'none';

  // When entering step 4, update hint and auto-detect button
  if (n === 4) { updateVarStep(); }
  // Land focus on the name field when entering the Name step, so the
  // Enter-through flow works even when arriving from the Template step.
  if (n === 1) { byId('processName')?.focus(); }
  // Without focus inside the frame, no key reaches the Enter listener on the document. The
  // template step has no input field, so the preselected tile
  // ("Empty process") gets the focus — Enter accepts it and moves on.
  if (n === 0) { document.querySelector<HTMLElement>('#tplList .tpl-item.selected')?.focus(); }
  currentStep = n;
}

function validateStep(n: number): boolean {
  if (n === 1) {
    const name = must<HTMLInputElement>('processName').value.trim();
    must('errName').textContent = name ? '' : T.nameRequired;
    return !!name;
  }
  return true;
}

// ------- Datasource section switching -------
const dsTypes = ['VIEW', 'SUBSET', 'CHARACTERDELIMITED', 'ODBC', 'NULL'];
const dsType = must<HTMLSelectElement>('dsType');

function needsVariables(): boolean {
  const t = dsType.value;
  return t === 'CHARACTERDELIMITED' || t === 'ODBC' || t === 'VIEW' || t === 'SUBSET';
}

function nextStep(): void {
  if (!validateStep(currentStep)) { return; }
  // Skip step 4 (variables) for NULL datasource
  if (currentStep === 3 && !needsVariables()) {
    createProcess();
    return;
  }
  if (currentStep < totalSteps) { showStep(currentStep + 1); }
}

function prevStep(): void {
  if (currentStep > MIN_STEP) { showStep(currentStep - 1); }
}

function updateDsSections(): void {
  const t = dsType.value;
  dsTypes.forEach((s) => {
    const el = byId('dssec-' + s);
    if (el) { el.className = 'dssec' + (s === t ? ' active' : ''); }
  });
}
dsType.addEventListener('change', updateDsSections);
updateDsSections();

// ------- Cube → Views -------
const cubeInput = byId<HTMLInputElement>('cubeInput');
const viewSelect = byId<HTMLSelectElement>('viewSelect');
let viewDeb: ReturnType<typeof setTimeout> | undefined;
if (cubeInput) {
  cubeInput.addEventListener('change', () => {
    clearTimeout(viewDeb);
    viewDeb = setTimeout(() => {
      if (cubeInput.value) {
        vscode.postMessage({ command: 'getViews', cube: cubeInput.value });
        vscode.postMessage({ command: 'getCubeDimensions', cube: cubeInput.value });
      }
    }, 300);
  });
}

// ------- Dimension → Subsets -------
const dimInput = byId<HTMLInputElement>('dimInput');
const subsetSelect = byId<HTMLSelectElement>('subsetSelect');
let subDeb: ReturnType<typeof setTimeout> | undefined;
if (dimInput) {
  dimInput.addEventListener('change', () => {
    clearTimeout(subDeb);
    subDeb = setTimeout(() => {
      if (dimInput.value) { vscode.postMessage({ command: 'getSubsets', dimension: dimInput.value }); }
    }, 300);
  });
}

function populateSelect(sel: HTMLSelectElement | null, names: string[]): void {
  if (!sel) { return; }
  const cur = sel.value;
  sel.innerHTML = '';
  names.forEach((n) => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === cur) { o.selected = true; }
    sel.appendChild(o);
  });
  if (!names.includes(cur) && cur) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = cur; o.selected = true;
    sel.insertBefore(o, sel.firstChild);
  }
}

let cubeDimensions: string[] = [];
window.addEventListener('message', (e: MessageEvent<HostToWebview>) => {
  const msg = e.data;
  if (msg.command === 'viewsLoaded') { populateSelect(viewSelect, msg.views); }
  if (msg.command === 'subsetsLoaded') { populateSelect(subsetSelect, msg.subsets); }
  if (msg.command === 'cubeDimensionsLoaded') {
    cubeDimensions = msg.dimensions || [];
    // Auto-populate variables table with cube dimensions
    must('varBody').innerHTML = '';
    cubeDimensions.forEach((dim, i) => addVar(dim, 2, i + 1));
  }
});

// ------- Parameter table -------
function addParam(name = '', type = 2, defaultValue = '', prompt = ''): void {
  if (!name) {
    const n = document.querySelectorAll('#paramBody tr').length + 1;
    name = 'pParam' + (n < 10 ? '0' : '') + n;
  }
  const id = Date.now() + Math.random();
  const tr = document.createElement('tr');
  tr.id = 'pr' + id;
  tr.innerHTML = `
      <td><input type="text" class="pname" value="${esc(name)}" placeholder="pName"></td>
      <td><select class="ptype"><option value="2"${type === 2 ? ' selected' : ''}>String</option><option value="1"${type === 1 ? ' selected' : ''}>Numeric</option></select></td>
      <td><input type="text" class="pdefault" value="${esc(defaultValue)}" placeholder=""></td>
      <td><input type="text" class="pprompt" value="${esc(prompt || name)}" placeholder="${esc(T.description)}"></td>
      <td><button class="del" data-row="pr${id}">×</button></td>`;
  must('paramBody').appendChild(tr);
}

function syncPrompt(nameInput: HTMLInputElement): void {
  const promptInput = nameInput.closest('tr')?.querySelector<HTMLInputElement>('.pprompt');
  if (promptInput && !promptInput.dataset.manual) {
    promptInput.value = nameInput.value;
  }
}

// ------- Variable table -------
function addVar(name = '', type = 2, position: number | null = null, ignored = false): void {
  const id = Date.now() + Math.random();
  const nextPos = document.querySelectorAll('#varBody tr').length + 1;
  const pos = position !== null ? position : nextPos;
  const tr = document.createElement('tr');
  tr.id = 'vr' + id;
  tr.innerHTML = `
      <td><input type="text" class="vname" value="${esc(name)}" placeholder="vsColumn"></td>
      <td><select class="vtype"><option value="2"${type === 2 ? ' selected' : ''}>String</option><option value="1"${type === 1 ? ' selected' : ''}>Numeric</option></select></td>
      <td><input type="number" class="vpos" value="${pos}" min="1" step="1" style="width:60px"></td>
      <td style="text-align:center"><input type="checkbox" class="vign"${ignored ? ' checked' : ''}></td>
      <td><button class="del" data-row="vr${id}">×</button></td>`;
  must('varBody').appendChild(tr);
}

function updateVarStep(): void {
  const t = dsType.value;
  const note = must('varNote');
  const autoBtn = must('btnAutoDetect');
  const hint = must('varHint');
  autoBtn.style.display = t === 'ODBC' ? '' : 'none';
  if (t === 'VIEW') {
    note.textContent = cubeDimensions.length > 0 ? T.varsFromCube : T.varsEnterCube;
    hint.textContent = T.varsCubeHint;
  } else if (t === 'SUBSET') {
    note.textContent = T.varsSubset;
    hint.textContent = '';
  } else if (t === 'ODBC') {
    note.textContent = '';
    hint.textContent = T.varsSqlHint;
  } else if (t === 'CHARACTERDELIMITED') {
    note.textContent = T.varsAscii;
    hint.textContent = '';
  } else {
    note.textContent = T.varsNone;
    hint.textContent = '';
  }
}

// Auto-detect variables from ODBC SQL SELECT
function autoDetect(): void {
  const sql = must<HTMLTextAreaElement>('odbcSql').value;
  const m = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
  if (!m) { return; }
  const cols = m[1].split(',').map((c) =>
    (c.trim().replace(/^\[|\]$|^"|"$/g, '').split(/\s+/).pop() ?? '').replace(/^\[|\]$/g, '').trim(),
  ).filter(Boolean);
  must('varBody').innerHTML = '';
  cols.forEach((col, i) => addVar(col, 2, i + 1));
}

// ------- Collect & submit -------
type DsFields = Omit<WizardFinish, 'name' | 'templateId' | 'params' | 'variables'>;

function collectDatasource(): DsFields {
  const t = dsType.value;
  const get = (id: string): string => byId<HTMLInputElement>(id)?.value || '';
  const ds: DsFields = { dsType: t };
  if (t === 'VIEW') {
    ds.datasourceName = get('cubeInput');
    ds.viewSubsetName = viewSelect ? viewSelect.value : '';
  } else if (t === 'SUBSET') {
    ds.datasourceName = dimInput ? dimInput.value : '';
    ds.viewSubsetName = subsetSelect ? subsetSelect.value : '';
  } else if (t === 'CHARACTERDELIMITED') {
    ds.datasourceName = get('cdFile');
    ds.delimiter = get('cdDelim');
    ds.quoteChar = get('cdQuote');
    ds.decimalSep = get('cdDecimal');
    ds.thousandSep = get('cdThousand');
    ds.titleRows = get('cdTitleRows');
  } else if (t === 'ODBC') {
    ds.datasourceName = get('odbcDsn');
    ds.odbcUsername = get('odbcUser');
    ds.odbcPassword = get('odbcPw');
    ds.usesUnicode = !!byId<HTMLInputElement>('odbcUnicode')?.checked;
    ds.sqlQuery = get('odbcSql');
  }
  return ds;
}

const cell = (tr: Element, cls: string): HTMLInputElement => tr.querySelector(cls) as HTMLInputElement;

function collectParams(): WizardParam[] {
  return Array.from(document.querySelectorAll('#paramBody tr')).map((tr) => ({
    name: cell(tr, '.pname').value.trim(),
    type: cell(tr, '.ptype').value,
    defaultValue: cell(tr, '.pdefault').value,
    prompt: cell(tr, '.pprompt').value,
  })).filter((p) => p.name);
}

function collectVars(): WizardVar[] {
  return Array.from(document.querySelectorAll('#varBody tr')).map((tr, i) => ({
    name: cell(tr, '.vname').value.trim(),
    type: cell(tr, '.vtype').value,
    position: cell(tr, '.vpos').value || String(i + 1),
    ignored: !!cell(tr, '.vign').checked,
  })).filter((v) => v.name);
}

function createProcess(): void {
  const name = must<HTMLInputElement>('processName').value.trim();
  if (!name) { showStep(1); return; }
  const params = collectParams();
  const seenNames = new Set<string>();
  for (const p of params) {
    if (seenNames.has(p.name.toLowerCase())) {
      showStep(3);
      must('errParams').textContent = T.paramDup.replace('{0}', p.name);
      return;
    }
    seenNames.add(p.name.toLowerCase());
  }
  must('errParams').textContent = '';
  vscode.postMessage({
    command: 'finish',
    data: {
      name,
      templateId: selectedTemplateId || null,
      ...collectDatasource(),
      params,
      variables: collectVars(),
    },
  });
}

function cancelWizard(): void {
  vscode.postMessage({ command: 'cancel' });
}

// Mark prompt as manually edited so sync stops
must('paramBody').addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.classList.contains('pname')) { syncPrompt(t); }
  if (t.classList.contains('pprompt')) {
    t.dataset.manual = '1';
  }
});

showStep(MIN_STEP);
if (MIN_STEP === 1) { must('processName').focus(); }
// Enter anywhere in the wizard advances to the next step — or creates on the
// final step — so a process with all-default sections can be created with just
// the name + Enter/Enter/Enter. Excluded: <textarea> (needs newlines) and
// <button> (native click, e.g. Back/Cancel).
// Escape cancels the wizard, like the Cancel button.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') { return; }
  e.preventDefault();
  cancelWizard();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') { return; }
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) { return; }
  // A <div> fires no native click on Enter, so a tile reached by Tab would
  // stay unselected while the wizard moves on with the previous pick.
  if (t && t.classList && t.classList.contains('tpl-item')) { selectTpl(t); }
  e.preventDefault();
  if (currentStep === totalSteps) { createProcess(); } else { nextStep(); }
});

// ------- Events -------
// Delegated and via ids instead of as an attribute on the element: under the CSP
// of this webview only nonce'd blocks run, attribute handlers do not.
const on = (id: string, fn: () => void): void => { byId(id)?.addEventListener('click', fn); };
on('btnAddParam', () => addParam());
on('btnAddVar', () => addVar());
on('btnAutoDetect', autoDetect);
on('btnBack', prevStep);
on('btnCancel', cancelWizard);
on('btnNext', nextStep);
on('btnCreate', createProcess);

document.querySelectorAll('.tpl-item').forEach((el) => {
  el.addEventListener('click', () => selectTpl(el));
});

for (const bodyId of ['paramBody', 'varBody']) {
  const tb = byId(bodyId);
  if (!tb) { continue; }
  tb.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.del');
    if (btn && btn.dataset.row) { byId(btn.dataset.row)?.remove(); }
  });
}
