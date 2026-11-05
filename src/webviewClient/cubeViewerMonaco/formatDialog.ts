/**
 * Format dialog: pick a display format for one or more elements of a
 * dimension, see it on the real values before applying. Display only — the
 * server never sees these formats (see `displayFormatPure`).
 */
import { state } from './state';
import { getL10n, fmt } from '../_shared/l10n';
import { formatTm1, validateTm1Format, type FormatProblem } from './tm1FormatPure';
import { buildFormat, parseFormat, DEFAULT_BLOCKS, MAX_DECIMALS, type FormatBlocks } from './formatBuilderPure';
import { withDisplayFormat } from '../../cubeViewer/displayFormatPure';
import { attrFormatStatus, composeAttrFormat, splitAttrFormat, type AttrFormatStatus } from './elementFormatPure';
import { vscode } from './vscodeApi';
import { showToast } from './dom';
import { applyNumberFormat, syncResetButton } from './grid';

const L = getL10n();

/** Fixed preview rows next to the selection's values: negative, zero, large. */
const EDGE_VALUES = [-1234567.375, 0, 1234567.891];
const MAX_SAMPLES = 5;
const MAX_RECENT = 6;

/** Session-wide, most recent first. */
const recent: string[] = [];

export interface FormatTarget { dim: string; elements: string[] }

/**
 * Where "Apply" writes. `display`: grid only. `attrCell`: the dialog was
 * opened on the `Format` column of `}ElementAttributes_<dim>` — Apply writes
 * that cell (prefix included), the plain manual maintenance with preview.
 */
export type FormatMode =
  | { kind: 'display' }
  | { kind: 'attrCell'; dim: string; elements: string[] };

let mode: FormatMode = { kind: 'display' };
/** Stored `Format` values of the current target's elements (prefix included). */
let serverRaw: Record<string, string> = {};
let serverReq = 0;
let writeReq = 0;
/** The user changed the pattern since the dialog opened: a late server read must not overwrite it. */
let edited = false;
// Own counter, NOT `nextReqId`/`state._reqSent`: that one is the refresh
// generation, and a dialog request must not make a pending `cellData` stale.
let formatReqSeq = 0;

interface Dom {
  overlay: HTMLElement;
  title: HTMLElement;
  dimRow: HTMLElement;
  dimSel: HTMLSelectElement;
  decimals: HTMLInputElement;
  group: HTMLInputElement;
  negative: HTMLSelectElement;
  zero: HTMLSelectElement;
  unit: HTMLInputElement;
  scale: HTMLSelectElement;
  percent: HTMLInputElement;
  pattern: HTMLInputElement;
  msg: HTMLElement;
  preview: HTMLElement;
  recent: HTMLElement;
  apply: HTMLButtonElement;
  server: HTMLElement;
  toServer: HTMLButtonElement;
}

let dom: Dom | null = null;
let targets: FormatTarget[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function getDom(): Dom {
  if (dom) { return dom; }
  dom = {
    overlay: $('fmt-modal'), title: $('fmt-title'), dimRow: $('fmt-dim-row'), dimSel: $('fmt-dim'),
    decimals: $('fmt-decimals'), group: $('fmt-group'), negative: $('fmt-negative'), zero: $('fmt-zero'),
    unit: $('fmt-unit'), scale: $('fmt-scale'), percent: $('fmt-percent'), pattern: $('fmt-pattern'),
    msg: $('fmt-msg'), preview: $('fmt-preview'), recent: $('fmt-recent'), apply: $('fmt-apply'),
    server: $('fmt-server'), toServer: $('fmt-to-server'),
  };
  return dom;
}

function current(): FormatTarget { return targets[Math.max(0, getDom().dimSel.selectedIndex)] ?? targets[0]; }

function readBlocks(d: Dom): FormatBlocks {
  return {
    decimals: Number(d.decimals.value) || 0,
    group: d.group.checked,
    negative: d.negative.value === 'parens' ? 'parens' : 'minus',
    zero: d.zero.value === 'blank' ? 'blank' : d.zero.value === 'dash' ? 'dash' : 'zero',
    unit: d.unit.value,
    scale: d.scale.value === 'k' ? 'k' : d.scale.value === 'm' ? 'm' : 'none',
    percent: d.percent.checked,
  };
}

function writeBlocks(d: Dom, b: FormatBlocks): void {
  d.decimals.value = String(b.decimals);
  d.group.checked = b.group;
  d.negative.value = b.negative;
  d.zero.value = b.zero;
  d.unit.value = b.unit;
  d.scale.value = b.scale;
  d.percent.checked = b.percent;
  // TM1 scales only without decimals; the field says so instead of lying.
  d.decimals.disabled = b.scale !== 'none';
}

/** Raw numbers of the cells that belong to the target elements. */
function sampleValues(t: FormatTarget): number[] {
  const m = state.lastMatrix;
  if (!m) { return []; }
  const want = new Set(t.elements);
  const onAxis = (dims: string[] | undefined, fallback: string[], tuples: string[][] | undefined, flat: string[]) => {
    const ds = dims?.length ? dims : fallback;
    const di = ds.indexOf(t.dim);
    if (di < 0) { return null; }
    return flat.map((_, i) => want.has((tuples?.[i] ?? [flat[i]])[di]));
  };
  const rows = onAxis(m.rowDims, state.rowDims, m.rowTuples, m.rowElements);
  const cols = onAxis(m.colDims, state.colDims, m.colTuples, m.colElements);
  const out: number[] = [];
  for (const [key, raw] of Object.entries(m.rawValues ?? {})) {
    const [ri, ci] = key.split(',').map(Number);
    if ((rows && !rows[ri]) || (cols && !cols[ci])) { continue; }
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n) && !out.includes(n)) { out.push(n); }
    if (out.length >= MAX_SAMPLES) { break; }
  }
  return out;
}

const REASON_KEY: Record<FormatProblem, string> = {
  empty: 'fmtErrEmpty', tooManySections: 'fmtErrSections', expression: 'fmtErrExpression',
  unquotedText: 'fmtErrUnquoted', unclosedQuote: 'fmtErrQuote', colour: 'fmtErrColour',
  namedFormat: 'fmtErrNamed', prefix: 'fmtErrPrefix', timePattern: 'fmtErrTime', noDigits: 'fmtErrNoDigits',
};

function render(): void {
  const d = getDom();
  const f = d.pattern.value;
  const check = validateTm1Format(f);
  d.apply.disabled = !check.ok;
  d.toServer.disabled = !check.ok;
  d.msg.textContent = check.ok ? '' : fmt(L, REASON_KEY[check.reason], check.at ?? '');
  d.preview.textContent = '';
  if (!check.ok) { return; }
  const sep = state.numFmt.comma ? { dec: ',', grp: '.' } : { dec: '.', grp: ',' };
  const samples = sampleValues(current());
  for (const v of [...samples, ...EDGE_VALUES.filter((e) => !samples.includes(e))]) {
    const tr = document.createElement('tr');
    const raw = document.createElement('td');
    raw.textContent = String(v);
    const out = document.createElement('td');
    out.textContent = formatTm1(v, f, sep);
    if (!samples.includes(v)) { tr.className = 'fmt-edge'; }
    tr.append(raw, out);
    d.preview.appendChild(tr);
  }
}

function renderRecent(): void {
  const d = getDom();
  d.recent.textContent = '';
  d.recent.hidden = recent.length === 0;
  for (const f of recent) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fmt-chip';
    b.textContent = f;
    b.addEventListener('click', () => { edited = true; setPattern(f); });
    d.recent.appendChild(b);
  }
}

function setPattern(f: string): void {
  const d = getDom();
  d.pattern.value = f;
  const b = parseFormat(f);
  if (b) { writeBlocks(d, b); }
  render();
}

function existingFormat(t: FormatTarget): string | undefined {
  const m = state.displayFormats[t.dim];
  return m ? t.elements.map((e) => m[e]).find(Boolean) : undefined;
}

/** Open for the given candidates; the first is preselected. */
export function openFormatDialog(candidates: FormatTarget[], openMode: FormatMode = { kind: 'display' }): void {
  mode = openMode;
  targets = openMode.kind === 'attrCell'
    ? [{ dim: openMode.dim, elements: openMode.elements }]
    : candidates.filter((t) => t.dim && t.elements.length);
  if (!targets.length) { return; }
  const d = getDom();
  d.dimSel.textContent = '';
  for (const t of targets) {
    const o = document.createElement('option');
    o.textContent = `${t.dim} › ${t.elements.length > 1 ? fmt(L, 'fmtElementsN', t.elements.length) : t.elements[0]}`;
    d.dimSel.appendChild(o);
  }
  d.dimSel.selectedIndex = 0;
  d.dimRow.hidden = targets.length < 2;
  openFor(targets[0]);
  d.overlay.classList.add('visible');
  d.pattern.focus();
}

function openFor(t: FormatTarget): void {
  const d = getDom();
  const attr = mode.kind === 'attrCell';
  d.title.textContent = fmt(L, attr ? 'fmtTitleAttr' : 'fmtTitle', t.dim);
  // Control dimensions (`}…`) get no Format attribute from here.
  d.toServer.hidden = attr || t.dim.startsWith('}');
  $('fmt-reset').hidden = attr;
  $('fmt-display-note').hidden = attr;
  setPattern(existingFormat(t) ?? buildFormat(DEFAULT_BLOCKS));
  edited = false;
  renderRecent();
  // The server's own format of these elements, read through the attribute cube.
  serverRaw = {};
  d.server.textContent = L.fmtServerLoading;
  d.server.classList.remove('fmt-warn');
  serverReq = ++formatReqSeq;
  vscode.postMessage({ type: 'readElementFormats', dimName: t.dim, elements: t.elements, reqId: serverReq });
}

const STATUS_KEY: Record<AttrFormatStatus, string> = {
  none: 'fmtAttrNone', ok: 'fmtAttrOk', okLegacy: 'fmtAttrOk',
  legacyBreaks: 'fmtAttrLegacyBreaks', ignored: 'fmtAttrIgnored',
};

/** Host answer to `readElementFormats`. */
export function onElementFormats(msg: { raw: Record<string, string>; error?: string; reqId: number }): void {
  if (msg.reqId !== serverReq) { return; }
  const d = getDom();
  serverRaw = msg.raw ?? {};
  if (msg.error) { d.server.textContent = fmt(L, 'fmtAttrReadFailed', msg.error); return; }
  const t = current();
  const distinct = [...new Set(t.elements.map((e) => serverRaw[e] ?? ''))];
  if (distinct.length > 1) { d.server.textContent = L.fmtAttrMixed; return; }
  const raw = distinct[0] ?? '';
  const status = attrFormatStatus(raw);
  d.server.textContent = raw ? `${fmt(L, 'fmtAttrStored', raw)} ${L[STATUS_KEY[status]]}` : L.fmtAttrNone;
  d.server.classList.toggle('fmt-warn', status === 'legacyBreaks' || status === 'ignored');
  // In the attribute cube the stored value IS what is being edited.
  if (edited) { return; }
  if (mode.kind === 'attrCell' && raw) { setPattern(splitAttrFormat(raw).pattern); }
  else if (mode.kind === 'display' && raw && !existingFormat(t) && status !== 'ignored') {
    setPattern(splitAttrFormat(raw).pattern);
  }
}

/** Host answer to `writeElementFormats`. */
export function onElementFormatsWritten(msg: { ok: boolean; cancelled?: boolean; error?: string; reqId: number }): void {
  if (msg.reqId !== writeReq) { return; }
  const d = getDom();
  d.toServer.disabled = false;
  d.apply.disabled = false;
  if (msg.cancelled) { return; }
  if (!msg.ok) { d.msg.textContent = fmt(L, 'fmtAttrWriteFailed', msg.error ?? ''); return; }
  const t = current();
  // The server renders it now; a display format on top would hide that.
  for (const e of t.elements) { state.displayFormats = withDisplayFormat(state.displayFormats, t.dim, e, ''); }
  close();
  syncResetButton();
  showToast(mode.kind === 'attrCell' ? L.fmtAttrCellWritten : L.fmtAttrWritten);
  // Reload so the grid shows the server's rendering (or the new cell value).
  document.getElementById('btn-refresh')?.click();
}

function writeToServer(pattern: string): void {
  const t = current();
  const values: Record<string, string> = {};
  for (const e of t.elements) { values[e] = pattern ? composeAttrFormat(pattern, serverRaw[e]) : ''; }
  const d = getDom();
  d.toServer.disabled = true;
  d.apply.disabled = true;
  writeReq = ++formatReqSeq;
  vscode.postMessage({ type: 'writeElementFormats', dimName: t.dim, values, reqId: writeReq });
}

function close(): void { getDom().overlay.classList.remove('visible'); }

function commit(format: string): void {
  const t = current();
  for (const e of t.elements) { state.displayFormats = withDisplayFormat(state.displayFormats, t.dim, e, format); }
  if (format) {
    const i = recent.indexOf(format);
    if (i >= 0) { recent.splice(i, 1); }
    recent.unshift(format);
    recent.length = Math.min(recent.length, MAX_RECENT);
  }
  close();
  syncResetButton();
  applyNumberFormat();
}

export function wireFormatDialog(): void {
  const d = getDom();
  d.decimals.max = String(MAX_DECIMALS);
  const fromBlocks = () => {
    edited = true;
    const b = readBlocks(d);
    d.decimals.disabled = b.scale !== 'none';
    d.pattern.value = buildFormat(b);
    render();
  };
  for (const el of [d.decimals, d.group, d.negative, d.zero, d.unit, d.scale, d.percent]) {
    el.addEventListener('input', fromBlocks);
    el.addEventListener('change', fromBlocks);
  }
  d.pattern.addEventListener('input', () => {
    edited = true;
    const b = parseFormat(d.pattern.value);
    if (b) { writeBlocks(d, b); }
    render();
  });
  d.dimSel.addEventListener('change', () => openFor(current()));
  const apply = () => {
    if (d.apply.disabled) { return; }
    if (mode.kind === 'attrCell') { writeToServer(d.pattern.value); } else { commit(d.pattern.value); }
  };
  d.apply.addEventListener('click', apply);
  d.toServer.addEventListener('click', () => { if (!d.toServer.disabled) { writeToServer(d.pattern.value); } });
  $('fmt-reset').addEventListener('click', () => commit(''));
  $('fmt-cancel').addEventListener('click', close);
  d.overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Enter' && !d.apply.disabled) { e.preventDefault(); apply(); }
  });
}
