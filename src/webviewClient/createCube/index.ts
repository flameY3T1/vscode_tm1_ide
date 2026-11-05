// src/webviewClient/createCube/index.ts
// Bundle of the "New Cube" dialog. Until 2026-10 this was an inline script in
// the host's template literal, invisible to tsc and eslint.
import type { CreateCubeBootstrap, HostToWebview, WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost>();
const { dimensions: ALL, texts: T } = (window as unknown as { __createCube: CreateCubeBootstrap }).__createCube;

let available = [...ALL];
let selected: string[] = [];
let activeAvail: string | null = null;
let activeSel: string | null = null;
let dimFilterText = '';
let showControl = false;

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const dimList = byId<HTMLUListElement>('dimList');
const dimFilterInput = byId<HTMLInputElement>('dimFilter');
const ctrlToggle = byId<HTMLInputElement>('ctrlToggle');
const selList = byId<HTMLUListElement>('selectedList');
const nameInput = byId<HTMLInputElement>('cubeName');
const errBox = byId<HTMLElement>('err');
const submitBtn = byId<HTMLButtonElement>('submit');

function render(): void {
  dimList.innerHTML = '';
  const visible = available.filter((d) =>
    (showControl || d.charAt(0) !== '}') &&
    (!dimFilterText || d.toLowerCase().includes(dimFilterText)));
  visible.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = d;
    if (d === activeAvail) li.classList.add('active');
    li.addEventListener('click', () => { activeAvail = d; render(); });
    li.addEventListener('dblclick', () => addSelected(d));
    dimList.appendChild(li);
  });
  selList.innerHTML = '';
  selected.forEach((d, i) => {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'order-badge';
    badge.textContent = (i + 1) + '.';
    const txt = document.createElement('span');
    txt.textContent = d;
    li.appendChild(badge);
    li.appendChild(txt);
    if (d === activeSel) li.classList.add('active');
    li.addEventListener('click', () => { activeSel = d; render(); });
    li.addEventListener('dblclick', () => removeSelected(d));
    selList.appendChild(li);
  });
  revalidate();
}

function addSelected(d: string | null): void {
  if (!d) return;
  if (selected.includes(d)) return;
  selected.push(d);
  available = available.filter((x) => x !== d);
  activeAvail = null;
  render();
}

function removeSelected(d: string | null): void {
  if (!d) return;
  selected = selected.filter((x) => x !== d);
  if (ALL.includes(d) && !available.includes(d)) {
    // Back to its original position, not to the end of the list.
    const origIdx = ALL.indexOf(d);
    const at = available.findIndex((x) => ALL.indexOf(x) > origIdx);
    if (at < 0) available.push(d); else available.splice(at, 0, d);
  }
  activeSel = null;
  render();
}

function move(delta: number): void {
  if (!activeSel) return;
  const i = selected.indexOf(activeSel);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= selected.length) return;
  [selected[i], selected[j]] = [selected[j], selected[i]];
  render();
}

function revalidate(): void {
  const name = nameInput.value.trim();
  errBox.textContent = name && selected.length < 2 ? T.minDims : '';
  submitBtn.disabled = !name || selected.length < 2;
}

byId('add').addEventListener('click', () => addSelected(activeAvail));
byId('remove').addEventListener('click', () => removeSelected(activeSel));
byId('up').addEventListener('click', () => move(-1));
byId('down').addEventListener('click', () => move(1));
byId('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
submitBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'submit', name: nameInput.value.trim(), dimensions: selected });
});
nameInput.addEventListener('input', revalidate);
// Enter in the name field creates the cube — via the button, so that the
// check (name + at least two dimensions) still comes first.
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
});
// Escape cancels, like the Cancel button — from anywhere in the form.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') { return; }
  e.preventDefault();
  vscode.postMessage({ type: 'cancel' });
});
dimFilterInput.addEventListener('input', () => {
  dimFilterText = dimFilterInput.value.trim().toLowerCase();
  if (activeAvail && !activeAvail.toLowerCase().includes(dimFilterText)) activeAvail = null;
  render();
});
ctrlToggle.addEventListener('change', () => {
  showControl = ctrlToggle.checked;
  if (!showControl && activeAvail && activeAvail.charAt(0) === '}') activeAvail = null;
  render();
});

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  if (msg && msg.type === 'validationError') {
    errBox.textContent = msg.message;
  }
});

render();
