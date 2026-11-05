export {};
import { getL10n, fmt } from '../_shared/l10n';
import { groupProcesses, type ProcessGroupingMode } from '../../providers/processGroupingPure';
import { compileProcessGroupPattern } from '../../providers/processGroupPatternPure';
import { escapeHtml } from '../htmlUtils';
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { HostToWebview, InitMsg, WebviewToHost } from './protocol';

const vscodeApi = getVsCodeApi<WebviewToHost>();
const L = getL10n();

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const tokInput = (): HTMLInputElement => $('tok') as HTMLInputElement;

/** How much of the preview is rendered — enough to judge a pattern, not a full tree. */
const MAX_GROUPS = 40;
const MAX_KIDS = 6;

let names: string[] = [];
let mode: ProcessGroupingMode = 'patternPrefix';

const isPattern = (m: ProcessGroupingMode): boolean =>
  m === 'patternPrefix' || m === 'patternSuffix';

function applyInit(init: InitMsg): void {
  names = init.names ?? [];
  mode = init.mode;
  $('hd').textContent = init.serverName;
  tokInput().value = init.token ?? '';
  selectMode(mode);
  render();
}

function selectMode(next: ProcessGroupingMode): void {
  mode = next;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.mode'))) {
    const on = el.dataset.mode === next;
    el.classList.toggle('on', on);
    const radio = el.querySelector('input') as HTMLInputElement | null;
    if (radio) { radio.checked = on; }
  }
  const pattern = isPattern(next);
  $('syntax').classList.toggle('hidden', !pattern);
  $('tokLbl').textContent = pattern ? L.tokenLabelPattern : L.tokenLabelLiteral;
  // Hint, example and pitfalls per mode (feedback from the team,
  // 2026-08-12: mode names + short hint were not enough to understand them).
  $('hint').textContent = next === 'patternPrefix' ? L.hintPatternStart
    : next === 'patternSuffix' ? L.hintPatternEnd
      : next === 'prefix' ? L.hintPrefix : L.hintSuffix;
  $('demo').textContent = next === 'patternPrefix' ? L.examplePatternStart
    : next === 'patternSuffix' ? L.examplePatternEnd
      : next === 'prefix' ? L.examplePrefix : L.exampleSuffix;
  // The pitfalls are stored as one string per mode in the bundle — a
  // list of sentences could not be translated as a unit in the l10n bundle. The
  // split into `<li>` therefore happens here, at the line breaks.
  const pitfalls = $('pitfalls');
  pitfalls.textContent = '';
  for (const line of (pattern ? L.pitfallPattern : L.pitfallLiteral).split('\n')) {
    if (!line.trim()) { continue; }
    const li = document.createElement('li');
    li.textContent = line;
    pitfalls.appendChild(li);
  }
  tokInput().placeholder = !pattern
    ? L.tokenPlaceholderLiteral
    : next === 'patternPrefix' ? L.tokenPlaceholderPatternStart : L.tokenPlaceholderPatternEnd;
}

/** Localized compile error for the current pattern, or '' when it is fine. */
function patternError(token: string): string {
  if (!isPattern(mode) || !token) { return ''; }
  const res = compileProcessGroupPattern(token, mode === 'patternPrefix' ? 'start' : 'end');
  if (res.ok) { return ''; }
  if (res.code === 'unclosed') { return L.errUnclosed; }
  if (res.code === 'empty') { return L.errEmpty; }
  return fmt(L, 'errUnknown', res.arg ?? '');
}

function render(): void {
  const token = tokInput().value;
  const err = patternError(token);
  $('err').textContent = err;

  const pv = $('pv');
  const sum = $('sum');
  pv.textContent = '';
  sum.textContent = '';

  if (names.length === 0) {
    pv.innerHTML = `<div class="pv-empty">${escapeHtml(L.previewNoNames)}</div>`;
    return;
  }
  if (err) { return; }
  if (!token) {
    pv.innerHTML = `<div class="pv-empty">${escapeHtml(L.previewNoGroups)}</div>`;
    return;
  }

  const groups = groupProcesses(names, token, mode);
  const real = groups.filter(g => g.marker !== null);
  if (real.length === 0) {
    pv.innerHTML = `<div class="pv-empty">${escapeHtml(fmt(L, 'previewNoMatch', L.ungrouped))}</div>`;
    return;
  }

  const html: string[] = [];
  for (const g of groups.slice(0, MAX_GROUPS)) {
    const label = g.marker ?? L.ungrouped;
    const kids = g.children.slice(0, MAX_KIDS).map(n => `<span>${escapeHtml(n)}</span>`);
    if (g.children.length > MAX_KIDS) {
      kids.push(`<span>${escapeHtml(fmt(L, 'more', g.children.length - MAX_KIDS))}</span>`);
    }
    html.push(
      '<div class="grp">',
      `<span class="grp-h${g.marker === null ? ' none' : ''}">${escapeHtml(label)}</span>`,
      `<span class="grp-c">${escapeHtml(fmt(L, 'countProcesses', g.children.length))}</span>`,
      `<div class="grp-kids">${kids.join('')}</div>`,
      '</div>',
    );
  }
  if (groups.length > MAX_GROUPS) {
    html.push(`<div class="pv-empty">${escapeHtml(fmt(L, 'more', groups.length - MAX_GROUPS))}</div>`);
  }
  pv.innerHTML = html.join('');
  sum.textContent = fmt(L, 'previewSummary', real.length, names.length);
}

// Grouping runs over every process name on each keystroke; a short debounce
// keeps typing smooth on servers with thousands of processes.
let timer = 0;
function scheduleRender(): void {
  clearTimeout(timer);
  timer = setTimeout(render, 120) as unknown as number;
}

function save(): void {
  if (patternError(tokInput().value)) { return; }
  vscodeApi.postMessage({ type: 'save', token: tokInput().value.trim(), mode });
}

for (const el of Array.from(document.querySelectorAll<HTMLElement>('.mode'))) {
  el.addEventListener('click', () => {
    selectMode(el.dataset.mode as ProcessGroupingMode);
    render();
  });
}
tokInput().addEventListener('input', scheduleRender);
tokInput().addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') { e.preventDefault(); save(); }
});
$('save').addEventListener('click', save);
$('reset').addEventListener('click', () => vscodeApi.postMessage({ type: 'reset' }));

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as HostToWebview;
  if (msg?.type === 'init') { applyInit(msg); }
});

const boot = (globalThis as unknown as { __pgInit?: InitMsg }).__pgInit;
if (boot) { applyInit(boot); }
tokInput().focus();
