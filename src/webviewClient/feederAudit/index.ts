// src/webviewClient/feederAudit/index.ts
// Bundle of the overfeeding window. Until 10-04 this was an inline script in
// a template literal of the host — without type checking and lint.
import type { FeederAuditL10n } from '../../webviews/feederAuditBodyPure';
import type { AuditResult, AuditHit, HostToWebview, WebviewToHost } from './protocol';
import { getVsCodeApi, type VsCodeApi } from '../_shared/vscodeApi';

type VsApi = VsCodeApi<WebviewToHost>;
const vscode = getVsCodeApi<WebviewToHost>();
// For the column drag script (webviews/columnResize.ts): the API can be acquired only once per webview.
(window as unknown as { tm1VsApi: VsApi }).tm1VsApi = vscode;

const L = (window as unknown as { __feederAuditL10n: FeederAuditL10n }).__feederAuditL10n;
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function fmt(template: string, ...args: unknown[]): string {
  return args.reduce<string>((s, a, i) => s.split('{' + i + '}').join(String(a)), template);
}

function showRunning(): void {
  $('status').textContent = L.running;
  $('status').classList.remove('err');
  $('tbl').hidden = true;
  $('empty').hidden = true;
  $('controls').hidden = true;
}

function feederBox(t: AuditHit): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'feeder-box';
  const head = document.createElement('div');
  head.className = 'feeder-head';
  box.appendChild(head);
  if (t.feederFehler) {
    head.textContent = fmt(L.feederFailed, t.feederFehler);
    head.classList.add('err');
    return box;
  }
  if (!t.feeder) {
    head.textContent = L.feederSearching;
    return box;
  }
  head.textContent = t.feeder.length ? L.feederHeading : L.feederNone;
  for (const f of t.feeder) {
    const row = document.createElement('div');
    row.className = 'feeder-item' + (f.sicher ? '' : ' unsure');
    row.title = L.openRule;
    const nr = document.createElement('span');
    nr.className = 'feeder-line';
    nr.textContent = fmt(L.line, f.zeile + 1);
    const txt = document.createElement('span');
    txt.className = 'feeder-text';
    txt.textContent = f.sicher ? f.text : f.text + '  — ' + fmt(L.feederUnsure, f.grund || '');
    row.appendChild(nr);
    row.appendChild(txt);
    row.addEventListener('click', () => vscode.postMessage({ type: 'openRule', zeile: f.zeile }));
    box.appendChild(row);
  }
  return box;
}

// The current finding. The window fills in the feeders per row afterwards, so
// it has to keep its own result.
let current: AuditResult | null = null;

/** Redraw the feeder row of a hit row. */
function redrawBox(i: number): void {
  const td = document.querySelector('tr.feeder[data-i="' + i + '"] td');
  if (!td || !current) { return; }
  td.textContent = '';
  td.appendChild(feederBox(current.treffer[i]));
}

function showResult(e: AuditResult): void {
  current = e;
  $('scope').textContent = fmt(L.scope, e.cube);
  $('controls').hidden = false;
  $<HTMLInputElement>('von').value = String(e.von);
  $<HTMLInputElement>('bis').value = String(e.bis);
  $<HTMLInputElement>('cache').checked = !!e.cacheLeeren;

  if (e.fehler) {
    $('status').textContent = fmt(L.failed, e.fehler);
    $('status').classList.add('err');
    $('tbl').hidden = true;
    $('empty').hidden = true;
    return;
  }
  $('status').classList.remove('err');

  const n = e.treffer.length;
  if (n === 0) {
    $('status').textContent = L.noHits;
    $('empty').textContent = L.noHitsHint;
    $('empty').hidden = false;
    $('tbl').hidden = true;
    return;
  }

  $('status').textContent = '';
  const strong = document.createElement('span');
  strong.className = 'count';
  strong.textContent = fmt(L.hits, n);
  $('status').appendChild(strong);
  if (e.gekappt) {
    const hint = document.createElement('div');
    hint.className = 'gekappt';
    hint.textContent = fmt(L.capped, e.bis, e.bis + 1);
    $('status').appendChild(hint);
  }
  if (e.verworfen > 0) {
    const hint = document.createElement('div');
    hint.textContent = fmt(L.dropped, e.verworfen);
    $('status').appendChild(hint);
  }
  $('empty').hidden = true;

  const head = $('head');
  head.textContent = '';
  const thNr = document.createElement('th');
  thNr.textContent = L.colNr;
  thNr.className = 'nr';
  head.appendChild(thNr);
  for (const d of e.dimensionen) {
    const th = document.createElement('th');
    th.textContent = d;
    head.appendChild(th);
  }

  const body = $('rows');
  body.textContent = '';
  e.treffer.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.className = 'zelle';
    tr.title = L.openCell;
    const tdNr = document.createElement('td');
    tdNr.className = 'nr';
    tdNr.textContent = String(e.von + i);
    tr.appendChild(tdNr);
    for (const k of t.koordinaten) {
      const td = document.createElement('td');
      td.className = 'coord';
      td.textContent = k;
      tr.appendChild(td);
    }
    body.appendChild(tr);

    const trF = document.createElement('tr');
    trF.className = 'feeder';
    trF.dataset.i = String(i);
    trF.hidden = true;
    const tdF = document.createElement('td');
    tdF.colSpan = e.dimensionen.length + 1;
    tdF.appendChild(feederBox(t));
    trF.appendChild(tdF);
    body.appendChild(trF);

    // Collapsing is collapsing — the assignment fetched once stays standing,
    // a second click does not ask again.
    tr.addEventListener('click', () => {
      trF.hidden = !trF.hidden;
      tr.classList.toggle('offen', !trF.hidden);
      const hit = current?.treffer[i];
      if (!trF.hidden && hit && !hit.feeder && !hit.feederFehler) {
        vscode.postMessage({ type: 'matchCell', index: i });
      }
    });
  });
  $('tbl').hidden = false;
}

/** Shift the area by its own width. */
function next(): void {
  if (!current) { return; }
  const width = current.bis - current.von + 1;
  $<HTMLInputElement>('von').value = String(current.bis + 1);
  $<HTMLInputElement>('bis').value = String(current.bis + width);
  start();
}

function start(): void {
  const v = Math.floor(Number($<HTMLInputElement>('von').value));
  const b = Math.floor(Number($<HTMLInputElement>('bis').value));
  // With to <= from the server returns an empty file and reports
  // success anyway — that must not pass as "nothing found".
  if (!Number.isFinite(v) || !Number.isFinite(b) || v < 1 || b <= v) {
    $('bereichFehler').hidden = false;
    return;
  }
  $('bereichFehler').hidden = true;
  showRunning();
  vscode.postMessage({ type: 'rerun', von: v, bis: b, cacheLeeren: $<HTMLInputElement>('cache').checked });
}

$('rerun').addEventListener('click', start);
$('weiter').addEventListener('click', next);

window.addEventListener('message', (ev: MessageEvent<HostToWebview | null>) => {
  const m = ev.data;
  if (!m) { return; }
  if (m.type === 'result') { showResult(m.ergebnis); return; }
  if (m.type === 'running') { showRunning(); return; }
  if (m.type === 'cellFeeder' && current && current.treffer[m.index]) {
    current.treffer[m.index].feeder = m.feeder;
    current.treffer[m.index].feederFehler = m.fehler;
    redrawBox(m.index);
  }
});
