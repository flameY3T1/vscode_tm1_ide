import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { identityTag } from '../tm1Rest/transport/session';
import { fetchProcessSections, getProcessParameters } from '../tm1Rest/processApi';
import { Tm1DebugClient } from '../debug/tm1DebugClient';
import { WebviewPanelHost } from '../webviews/webviewPanelHost';
import { renderWebviewShell } from '../webviews/webviewShell';
import { escapeHtml } from '../utils/escapeHtml';
import { errMsg } from '../utils/errMsg';
import { askParamsInPanel, answerParamAsk } from './processEditor/processParams';
import type { ParamsAnswer } from '../webviewClient/_shared/paramPromptProtocol';
import { getServerNameByUrl, formatServerLabel } from '../serverState/state';
import { walkCoverage } from './processCoverageWalk';
import {
  SECTIONS, buildModel, branchStatus, lineKey, mergedHits, percent, procedureName, sameSections, summarize,
  type BranchDef, type CoverageModel, type CoverageRun, type Section, type Sections,
} from './processCoveragePure';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';

/**
 * "Run with Coverage": run the process in the debugger and show which
 * lines and branches it reached. Multiple runs (e.g. with different
 * parameters) are merged together, as long as the source stays the same.
 *
 * Runs live only in the window: closing it discards them.
 */

type Msg =
  | { type: 'run'; cap: number }
  | { type: 'reset' }
  | { type: 'open'; section: Section; line: number }
  /** The (re)rendered page is listening — only then may `askParams` be posted. */
  | { type: 'ready' }
  | ParamsAnswer;

/** Jump into the process editor; comes from the caller that holds the editor manager. */
export type OpenAtLine = (cfg: Tm1Config, processName: string, section: Section, line: number) => unknown;

export interface State {
  cfg: Tm1Config;
  processName: string;
  sections: Sections;
  model: CoverageModel;
  runs: CoverageRun[];
  running: boolean;
  cap: number;
  note?: string;
  /** Window closed: a still-running run no longer renders. */
  disposed?: boolean;
  /** Resolves once the current page posted `ready`; renewed on every render. */
  ready?: Promise<void>;
  markReady?: () => void;
}

const host = new WebviewPanelHost<Msg>('tm1.processCoverage', 'TM1 Coverage');
const states = new Map<string, State>();

let extUri: vscode.Uri | undefined;

export function initializeProcessCoverage(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
  extUri = extensionUri;
}

export function disposeProcessCoveragePanelsForServer(serverUrl: string): void {
  host.disposePanelsForServer(serverUrl);
}

registerServerDisposer('processCoveragePanel', (url) => disposeProcessCoveragePanelsForServer(url));

export const CAP_OPTIONS = [1, 10, 100, 1000] as const;

function capLabel(n: number): string {
  return n === 1 ? vscode.l10n.t('Reached / not reached (fastest)') : vscode.l10n.t('Count hits up to {0}', n);
}

function branchLabel(b: BranchDef): string {
  switch (b.kind) {
    case 'if': return `IF (${b.condition})`;
    case 'elseif': return `ELSEIF (${b.condition})`;
    case 'else': return 'ELSE';
    case 'implicitElse': return vscode.l10n.t('no branch taken');
    case 'whileBody': return vscode.l10n.t('loop body');
    case 'whileSkipped': return vscode.l10n.t('loop skipped');
  }
}

const CSS = `
  html, body { height: 100%; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
  /* Header bar like the transaction log and the message log (commands/transactionLog.ts). */
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); flex-shrink: 0; flex-wrap: wrap; }
  .toolbar .title { font-weight: 600; margin-right: 8px; display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .toolbar .spacer { flex: 1; }
  .toolbar button { background: transparent; color: var(--vscode-foreground); border: 1px solid transparent; padding: 4px 10px; cursor: pointer; border-radius: 4px; font-size: 12px; }
  .toolbar button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
  .toolbar button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-border, transparent); font-weight: 600; }
  .toolbar button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .toolbar button:disabled { opacity: 0.5; cursor: default; }
  .toolbar button:focus-visible, .toolbar select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .toolbar select {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); padding: 3px 20px 3px 6px; font-size: 12px; border-radius: 2px;
    font-family: var(--vscode-font-family);
    appearance: none; -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23888888' stroke-width='1.3' d='M4 6.5 8 10.5 12 6.5'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 4px center; background-size: 12px 12px;
  }
  .toolbar label { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #4caf50); display: inline-block; flex-shrink: 0; }
  .dot.busy { background: var(--vscode-charts-yellow, #d7a300); }
  .content { overflow: auto; flex: 1 1 auto; min-height: 0; padding: 0 12px 16px; }
  .hint { color: var(--vscode-descriptionForeground); margin: 10px 0; font-size: 12px; }
  .warn { color: var(--vscode-editorWarning-foreground, #bf8803); margin: 8px 0; font-size: 12px; }
  table { border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  th, td { text-align: left; padding: 4px 12px 4px 0; vertical-align: top; }
  th { font-weight: 600; white-space: nowrap; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
  .bar { display: inline-block; width: 80px; height: 8px; background: var(--vscode-testing-uncoveredGutterBackground, var(--vscode-editorGutter-deletedBackground, #c33)); vertical-align: middle; margin-right: 6px; }
  .bar > i { display: block; height: 100%; background: var(--vscode-testing-coveredGutterBackground, var(--vscode-editorGutter-addedBackground, #3a3)); }
  h2 { font-size: 13px; margin: 20px 0 6px; }
  .code { font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; border: 1px solid var(--vscode-panel-border); overflow-x: auto; }
  .ln { display: flex; cursor: pointer; }
  .ln:hover { background: var(--vscode-list-hoverBackground); }
  .ln .no { width: 44px; text-align: right; padding-right: 8px; color: var(--vscode-editorLineNumber-foreground); flex-shrink: 0; }
  .ln .cnt { width: 56px; text-align: right; padding-right: 8px; flex-shrink: 0; color: var(--vscode-descriptionForeground); }
  .ln .mark { width: 4px; flex-shrink: 0; margin-right: 8px; }
  /* The colors of VS Code's built-in test coverage — every theme ships them. */
  .ln.hit .mark { background: var(--vscode-testing-coveredGutterBackground, var(--vscode-editorGutter-addedBackground, #3a3)); }
  .ln.miss .mark { background: var(--vscode-testing-uncoveredGutterBackground, var(--vscode-editorGutter-deletedBackground, #c33)); }
  .ln.miss .src { background: var(--vscode-testing-uncoveredBackground, var(--vscode-diffEditor-removedLineBackground, rgba(200,50,50,.12))); }
  /* High contrast: fill colors are missing or vanish on black — the line gets an outline. */
  body.vscode-high-contrast .ln.miss .src, body.vscode-high-contrast-light .ln.miss .src { outline: 1px dashed var(--vscode-contrastBorder, currentColor); outline-offset: -1px; }
  .ln.part .mark { background: var(--vscode-testing-uncoveredBranchBackground, var(--vscode-editorWarning-foreground, #c90)); }
  .ln .src { flex: 1; }
  .br { display: block; padding-left: 116px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .br .no { color: var(--vscode-errorForeground); }
  .br .yes { color: var(--vscode-testing-iconPassed, #3a3); }
  .only-miss .ln.hit, .only-miss .ln.plain { display: none; }
`;

function renderSummaryRow(label: string, model: CoverageModel, runs: CoverageRun[], only?: Section): string {
  const s = summarize(model, runs, only);
  const lp = percent(s.hitLines, s.lines);
  const bp = percent(s.takenBranches, s.branches);
  return `<tr><td>${escapeHtml(label)}</td>`
    + `<td><span class="bar"><i style="width:${lp}%"></i></span>${lp}% (${s.hitLines}/${s.lines})</td>`
    + `<td>${s.branches === 0 ? '–' : `<span class="bar"><i style="width:${bp}%"></i></span>${bp}% (${s.takenBranches}/${s.branches})`
      + (s.unknownBranches > 0 ? ` · ${escapeHtml(vscode.l10n.t('{0} undetermined', s.unknownBranches))}` : '')}</td></tr>`;
}

function renderSection(s: Section, st: State): string {
  const m = st.model[s];
  const text = st.sections[s] ?? '';
  if (m.lines.length === 0) { return ''; }
  const { hits, capped, byRun } = mergedHits(st.runs);
  const exec = new Set(m.lines);
  const out: string[] = [`<h2>${escapeHtml(procedureName(s))}</h2>`];
  if (m.parseError) {
    out.push(`<div class="warn">${escapeHtml(vscode.l10n.t('Parser stopped at line {0} — lines are counted roughly, branches are left out.', m.parseError))}</div>`);
  }
  // The opening lines of a multi-line statement carry the color of their closing line.
  const endOf = new Map<number, number>();
  for (const [e, b] of Object.entries(m.starts)) { for (let l = b; l < Number(e); l++) { endOf.set(l, Number(e)); } }
  out.push('<div class="code">');
  text.split('\n').forEach((src, i) => {
    const line = endOf.get(i + 1) ?? i + 1;
    const own = i + 1;
    const k = lineKey(s, line);
    const n = hits.get(k) ?? 0;
    const heads = own === line ? m.branches.filter(b => b.line === line) : [];
    const brSt = heads.map(b => ({ b, st: branchStatus(b, st.model, st.runs) }));
    let cls = 'plain';
    if (exec.has(line) && st.runs.length > 0) {
      cls = n === 0 ? 'miss' : brSt.some(x => x.st.runs.length === 0 && !x.st.unknown) ? 'part' : 'hit';
    }
    const runsHit = byRun.get(k);
    const title = runsHit ? vscode.l10n.t('Reached in run(s) {0}', runsHit.join(', ')) : '';
    const cnt = own !== line || !exec.has(line) || st.runs.length === 0 ? '' : n === 0 ? '0' : capped.has(k) ? (st.runs.every(r => r.cap <= 1) ? '✓' : `≥${n}`) : String(n);
    out.push(`<div class="ln ${cls}" data-s="${s}" data-l="${own}" title="${escapeHtml(title)}">`
      + `<span class="no">${own}</span><span class="mark"></span><span class="cnt">${cnt}</span><span class="src">${escapeHtml(src) || ' '}</span></div>`);
    if (st.runs.length > 0 && brSt.length > 0) {
      const parts = brSt.map(({ b, st: x }) => {
        const mark = x.runs.length > 0 ? `<span class="yes">✓ ${escapeHtml(vscode.l10n.t('run {0}', x.runs.join(', ')))}</span>`
          : x.unknown ? '?' : '<span class="no">✗</span>';
        return `${escapeHtml(branchLabel(b))}: ${mark}`;
      });
      out.push(`<span class="br">${parts.join(' · ')}</span>`);
    }
  });
  out.push('</div>');
  return out.join('');
}

function body(st: State): string {
  const runRows = st.runs.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(new Date(r.at).toLocaleString())}</td>`
    + `<td>${escapeHtml(r.params.map(p => `${p.Name}=${p.Value}`).join(', ') || '–')}</td>`
    + `<td>${escapeHtml(r.cancelled ? vscode.l10n.t('recording stopped, process ran to the end') : r.status)}</td>`
    + `<td>${escapeHtml(r.cap <= 1 ? '–' : `≤${r.cap}`)}</td><td>${(r.durationMs / 1000).toFixed(1)} s</td></tr>`).join('');
  const caps = CAP_OPTIONS.map(n => `<option value="${n}"${n === st.cap ? ' selected' : ''}>${escapeHtml(capLabel(n))}</option>`).join('');
  return `
<div class="toolbar">
  <span class="title"><span class="dot${st.running ? ' busy' : ''}"></span>${escapeHtml(vscode.l10n.t('Coverage'))}: ${escapeHtml(st.processName)}</span>
  <button id="runBtn" class="primary"${st.running ? ' disabled' : ''}>▶ ${escapeHtml(st.running ? vscode.l10n.t('Running…') : st.runs.length ? vscode.l10n.t('Add run') : vscode.l10n.t('Run'))}</button>
  <label><select id="capSel" title="${escapeHtml(vscode.l10n.t('Counting hits stops at every loop pass until the limit — slower.'))}">${caps}</select></label>
  <label><input type="checkbox" id="missChk" /> ${escapeHtml(vscode.l10n.t('Only lines not reached'))}</label>
  <div class="spacer"></div>
  <button id="resetBtn"${st.runs.length && !st.running ? '' : ' disabled'}>${escapeHtml(vscode.l10n.t('Reset'))}</button>
</div>
<div class="content">
<div class="hint">${escapeHtml(vscode.l10n.t('Each run executes the process for real in the debugger — data changes happen as with Execute. Processes it calls via ExecuteProcess run as well, but are not covered. Click a line to open it in the process editor.'))}</div>
${st.note ? `<div class="warn">${escapeHtml(st.note)}</div>` : ''}
${st.runs.length === 0 ? `<div class="hint">${escapeHtml(vscode.l10n.t('No run yet.'))}</div>` : `
<table><tr><th></th><th>${escapeHtml(vscode.l10n.t('Lines'))}</th><th>${escapeHtml(vscode.l10n.t('Branches'))}</th></tr>
${renderSummaryRow(vscode.l10n.t('Total'), st.model, st.runs)}
${SECTIONS.filter(s => st.model[s].lines.length > 0).map(s => renderSummaryRow(procedureName(s), st.model, st.runs, s)).join('')}
</table>
<table><tr><th>#</th><th>${escapeHtml(vscode.l10n.t('Started'))}</th><th>${escapeHtml(vscode.l10n.t('Parameters'))}</th><th>${escapeHtml(vscode.l10n.t('Status'))}</th><th>${escapeHtml(vscode.l10n.t('Hit limit'))}</th><th>${escapeHtml(vscode.l10n.t('Duration'))}</th></tr>${runRows}</table>`}
<div id="code">${SECTIONS.map(s => renderSection(s, st)).join('')}</div>
</div>`;
}


/** Exported for the guard `src/test/commands/processCoverage.test.ts`. */
export function renderHtml(webview: vscode.Webview, st: State): string {
  return renderWebviewShell({
    cspSource: webview.cspSource, css: CSS, body: body(st),
    scriptUris: extUri ? [String(webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'out', 'webview', 'processCoverage.js')))] : [],
  });
}

async function loadSections(cfg: Tm1Config, name: string): Promise<Sections> {
  const sec = await fetchProcessSections(name, cfg);
  if (!sec) { throw new Error(vscode.l10n.t('Process "{0}" not found.', name)); }
  return { prolog: sec.prolog, metadata: sec.metadata, data: sec.data, epilog: sec.epilog };
}

/**
 * The lock sits HERE, before the first confirmation prompt: the confirmation
 * prompt, the parameter form and the source fetch all wait, and a second
 * "Run" during that time would execute the process — including its data
 * changes — a second time.
 */
export async function doRun(st: State, panel: vscode.WebviewPanel, cap: number): Promise<void> {
  if (st.running) { return; }
  st.running = true;
  try {
    await runOnce(st, panel, cap);
  } finally {
    st.running = false;
    refresh(st, panel);
  }
}

async function runOnce(st: State, panel: vscode.WebviewPanel, cap: number): Promise<void> {
  const server = formatServerLabel(st.cfg.serverUrl, getServerNameByUrl) || st.cfg.serverUrl;
  const RUN = vscode.l10n.t('Run');
  const ok = await vscode.window.showWarningMessage(
    vscode.l10n.t('Run "{0}" on {1} for real?', st.processName, server),
    { modal: true, detail: vscode.l10n.t('Coverage runs the process in the debugger. All data changes happen as with Execute.') },
    RUN,
  );
  if (ok !== RUN) { return; }

  const apiParams = (await getProcessParameters(st.cfg, st.processName)) as Array<{ Name: string; Type: string; Value: string; Prompt: string }>;
  // Ask inside this window, not in a second tab (2026-10-28).
  if (apiParams.length > 0) { await st.ready; }
  if (st.disposed) { return; }
  const params = await askParamsInPanel(panel, st.processName, apiParams, vscode.l10n.t('Run with Coverage'), st.cfg.serverUrl);
  if (params === undefined) { return; }

  // The server executes ITS state: that must be the one counted against.
  const now = await loadSections(st.cfg, st.processName);
  st.note = undefined;
  if (!sameSections(now, st.sections)) {
    if (st.runs.length > 0) {
      st.note = vscode.l10n.t('The process changed on the server since the last run — earlier runs were discarded.');
    }
    st.runs = [];
    st.sections = now;
    st.model = buildModel(now);
  }

  st.cap = cap;
  refresh(st, panel);
  try {
    const run = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Recording coverage of "{0}"', st.processName),
      cancellable: true,
    }, (progress, token) => walkCoverage(new Tm1DebugClient(st.cfg), st.processName, params, st.model, {
      cap,
      isCancelled: () => token.isCancellationRequested,
      onProgress: (stops) => progress.report({ message: vscode.l10n.t('{0} stop(s)', stops) }),
    }));
    st.runs.push(run);
  } catch (err) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Coverage run failed: {0}', errMsg(err)));
  }
}

function refresh(st: State, panel: vscode.WebviewPanel): void {
  // A run outlives the window (close, disconnect): do not render after that.
  if (st.disposed) { return; }
  panel.webview.html = render(panel.webview, st);
}

/** Render and arm the ready signal: the new page reloads its bundle. */
function render(webview: vscode.Webview, st: State): string {
  st.ready = new Promise((resolve) => { st.markReady = resolve; });
  return renderHtml(webview, st);
}

export async function runProcessCoverageCommand(cfg: Tm1Config, processName: string, openAt: OpenAtLine): Promise<void> {
  // Identity tag: profile B must not re-run A's panel (and so run the process as A).
  const key = `${cfg.serverUrl}::@${identityTag(cfg)}:coverage#${processName.toLowerCase()}`;
  const existing = states.get(key);
  const panelNow = host.get(key);
  if (existing && panelNow) {
    panelNow.reveal();
    await doRun(existing, panelNow, existing.cap);
    return;
  }
  let sections: Sections;
  try {
    sections = await loadSections(cfg, processName);
  } catch (err) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Coverage run failed: {0}', errMsg(err)));
    return;
  }
  const st: State = { cfg, processName, sections, model: buildModel(sections), runs: [], running: false, cap: 1 };
  const label = formatServerLabel(cfg.serverUrl, getServerNameByUrl);
  const panel = host.open({
    key,
    title: `${label ? `${label} : ` : ''}${vscode.l10n.t('Coverage')}: ${processName}`,
    html: (webview) => render(webview, st),
    onMessage: async (msg, p) => {
      if (msg.type === 'run') { await doRun(st, p, Number(msg.cap) || 1); return; }
      if (msg.type === 'reset') { st.runs = []; st.note = undefined; refresh(st, p); return; }
      if (msg.type === 'ready') { st.markReady?.(); return; }
      if (msg.type === 'paramsAnswer') { answerParamAsk(msg.requestId, msg.values); return; }
      if (msg.type === 'open') {
        await openAt(cfg, processName, msg.section, msg.line);
      }
    },
    // Release a run waiting for `ready`; it then sees `disposed` and stops.
    onDispose: () => { st.disposed = true; st.markReady?.(); states.delete(key); },
  });
  if (!panel) { return; }
  states.set(key, st);
  await doRun(st, panel, st.cap);
}
