// src/notebook/tm1Notebook.ts
// TM1 notebook: `*.tm1nb` files with Markdown, MDX and TI cells. An MDX cell
// shows its cellset as a table; a TI cell runs as an unbound process
// (`ExecuteProcessWithReturn`, nothing is created on the server) and shows the
// status plus the error log. A TI cell can call `ExecuteProcess(...)`, so one
// notebook mixes "run the load" with "check the numbers".
//
// For closing checklists: a `// check: …` line turns an MDX cell into a check
// (green/red), parameter cells define `{Name}` placeholders for all cells, and
// the last run of every cell can be exported as a Markdown report.

import * as vscode from 'vscode';
import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { withSandbox, getActiveSandboxName } from '../tm1Rest/sandboxTracker';
import { executeMdx, abortMdxCellset, type ApiFetcher } from '../mdx/executeMdx';
import { runTransientProcess } from '../tm1Rest/transientProcess';
import { runCancellableProcess } from '../runState/runCancellableProcess';
import { terminateTiSnippet } from '../webviews/tiConsolePure';
import { getServerConfig } from '../serverState/state';
import { serverIdForCommand } from '../serverState/requireServerConfig';
import { getServerNameByUrl } from '../serverState/state';
import { errMsg } from '../utils/errMsg';
import { escapeHtml } from '../utils/escapeHtml';
import { getMdxContext, pickMembers } from '../mdx/mdxContext';
import { escapeMdx } from '../utils/odataKey';
import { MDX_KEYWORDS, ALL_FUNCTIONS, MEMBER_PROPERTIES } from '../mdx/mdxFunctions';
import { getCubes, getCubeDims, getElementNames } from '../mdx/mdxSchemaCache';
import { formatMdx } from '../mdx/formatMdxPure';
import { parseBodySafe } from '../tm1Rest/parseRest';
import { fetchChoreRunStats } from '../tm1Rest/runStatsApi';
import {
  MDX_CELL_LANGUAGE, TI_CELL_LANGUAGE, PARAMS_CELL_LANGUAGE, STATUS_CELL_LANGUAGE, TEMPLATES,
  parseNotebookFile, stringifyNotebookFile, cellsetToHtml, cellsetToMarkdown,
  parseParams, applyParams, parseCheck, stripCheckLine, describeCheck, evaluateCheck, buildReport,
  parseCellName, tableSum, reconcile, runStamp, storedSum, parseStatusLines, errorLogsSince, choreRunSince,
  type NotebookFileCell, type ReportCell, type TemplateId,
} from './notebookPure';
import { Tm1HttpError } from '../tm1Rest/httpError';

const NOTEBOOK_TYPE = 'tm1-notebook';

/** Labels the run in the message log and names its error-log file. */
const TI_PROC_NAME = `}VSCode_Notebook_${Math.random().toString(36).slice(2, 8)}`;

function toNotebookData(cells: NotebookFileCell[]): vscode.NotebookData {
  return new vscode.NotebookData(cells.map(c => c.kind === 'markdown'
    ? new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, c.source, 'markdown')
    : new vscode.NotebookCellData(vscode.NotebookCellKind.Code, c.source, c.language ?? MDX_CELL_LANGUAGE)));
}

class Tm1NotebookSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(content: Uint8Array): vscode.NotebookData {
    return toNotebookData(parseNotebookFile(new TextDecoder().decode(content)).cells);
  }

  serializeNotebook(data: vscode.NotebookData): Uint8Array {
    const cells: NotebookFileCell[] = data.cells.map(c => c.kind === vscode.NotebookCellKind.Markup
      ? { kind: 'markdown', source: c.value }
      : { kind: 'code', language: c.languageId, source: c.value });
    return new TextEncoder().encode(stringifyNotebookFile({ cells }));
  }
}

/**
 * Server per open notebook, picked on the first run. Kept in memory only:
 * the file names no server, so the same checks run against dev or prod.
 */
const serverByNotebook = new Map<string, string>();

async function serverFor(nb: vscode.NotebookDocument): Promise<string | undefined> {
  const key = nb.uri.toString();
  const known = serverByNotebook.get(key);
  if (known && getServerConfig(known)) { return known; }
  // The chosen server is gone: never switch silently. With only prod left
  // connected, a load meant for dev would otherwise run on prod.
  const picked = await serverIdForCommand(undefined, known ? {
    alwaysAsk: true,
    placeHolder: vscode.l10n.t("The notebook's server is no longer connected. Select a server to run on."),
  } : {});
  if (picked) { serverByNotebook.set(key, picked); }
  return picked;
}

function serverLabel(serverId: string): string {
  const url = getServerConfig(serverId)?.serverUrl;
  return (url && getServerNameByUrl(url)) || serverId;
}

/**
 * The server's config, or a readable error. Disconnecting mid-run removed the
 * config, and the former `!` turned that into "Cannot read properties of
 * undefined (reading 'serverUrl')" in every following cell (review
 * 2026-10-03, A8).
 */
function cfgOf(serverId: string): Tm1Config {
  const cfg = getServerConfig(serverId);
  if (!cfg) { throw new Error(vscode.l10n.t("The notebook's server is no longer connected. Select a server to run on.")); }
  return cfg;
}

function apiFor(serverId: string): ApiFetcher {
  const cfg = cfgOf(serverId);
  // Read once: a sandbox switch mid-cell must not mix two contexts in one result.
  const headers = withSandbox(cfg);
  return (method, path, body) => apiRequest(method, path, body, undefined, cfg, headers);
}

/**
 * Context each code cell last ran under. The report counts a result only when
 * it matches the context in its header: after changing a parameter, the old
 * pass belongs to the old parameters. Session-only, like `executionSummary`.
 */
const stampByCell = new WeakMap<vscode.TextDocument, string>();

/** Server, sandbox and parameters a run happens under — see {@link runStamp}. */
function currentStamp(nb: vscode.NotebookDocument, serverId: string): string {
  return runStamp(serverId, notebookParams(nb), getActiveSandboxName(getServerConfig(serverId)));
}

/** Parameters of ALL parameter cells, top to bottom — they apply without being run. */
function notebookParams(nb: vscode.NotebookDocument): Record<string, string> {
  return Object.assign({}, ...nb.getCells()
    .filter(c => c.document.languageId === PARAMS_CELL_LANGUAGE)
    .map(c => parseParams(c.document.getText())));
}

/**
 * `report` is the Markdown this run contributes to the exported report; `sum`
 * (MDX cells) is what a `// check: = <name>` in another cell reconciles against,
 * `stamp` ({@link runStamp}) the server and parameters it was computed with.
 */
function output(
  items: vscode.NotebookCellOutputItem[], report: string, sum?: { sum: number; stamp: string },
): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput(items, sum === undefined ? { report } : { report, ...sum });
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Last sum of the cell marked `// name: <ref>`; throws with a message the user can act on. */
function referencedSum(nb: vscode.NotebookDocument, self: vscode.NotebookCell, ref: string, stamp: string): number {
  const target = nb.getCells().find(c => c !== self
    && c.document.languageId === MDX_CELL_LANGUAGE
    && parseCellName(c.document.getText())?.toLowerCase() === ref.toLowerCase());
  if (!target) { throw new Error(vscode.l10n.t('No cell is named "{0}". Mark it with // name: {0}', ref)); }
  const sum = storedSum(target.outputs[0]?.metadata, stamp);
  if (sum === 'missing') { throw new Error(vscode.l10n.t('Cell "{0}" has no result yet. Run it first.', ref)); }
  if (sum === 'stale') {
    throw new Error(vscode.l10n.t('Cell "{0}" ran against another server, sandbox or other parameters. Run it again first.', ref));
  }
  return sum;
}

function banner(ok: boolean, text: string): string {
  const color = ok ? 'var(--vscode-testing-iconPassed, #3fb950)' : 'var(--vscode-testing-iconFailed, #f85149)';
  return `<p style="color:${color};font-weight:600;margin:4px 0">${ok ? '✅' : '❌'} ${escapeHtml(text)}</p>`;
}

async function runMdxCell(
  serverId: string,
  source: string,
  cell: vscode.NotebookCell,
): Promise<{ ok: boolean; out: vscode.NotebookCellOutput }> {
  const check = parseCheck(source);
  if (typeof check === 'string') {
    throw new Error(vscode.l10n.t(
      'Unknown check "{0}". Use empty, zero, [abs] <op> <number> or = <name> [± <tolerance>].', check));
  }
  // Resolve the reference before querying: a missing partner cell is the user's
  // mistake and should not cost a server round trip.
  const stamp = currentStamp(cell.notebook, serverId);
  const other = check?.kind === 'reconcile' ? referencedSum(cell.notebook, cell, check.ref, stamp) : undefined;
  const api = apiFor(serverId);
  const res = await executeMdx(stripCheckLine(source), api);
  if (!res.ok) {
    if (res.needsConfirm) {
      // ponytail: no "load anyway" in a notebook; narrow the query instead.
      await abortMdxCellset(res.cellsetId, api);
      throw new Error(vscode.l10n.t('The result has {0} cells. Narrow the query.', res.cellCount));
    }
    throw new Error(`${res.error.code}: ${res.error.message}`);
  }
  const info = `${serverLabel(serverId)} · ${res.table.dims.rows} × ${res.table.dims.cols} · ${res.elapsedMs} ms`;
  let head = '';
  let reportHead = '';
  let ok = true;
  const sum = tableSum(res.table);
  if (check?.kind === 'reconcile') {
    const r = reconcile(sum, other!, check.tol);
    ok = r.ok;
    const text = (r.ok
      ? vscode.l10n.t('Check passed: {0}', describeCheck(check))
      : vscode.l10n.t('Check failed: {0}', describeCheck(check)))
      + ` · ${vscode.l10n.t('this cell {0}, {1} {2}, difference {3}', fmtNum(r.own), check.ref, fmtNum(r.other), fmtNum(r.diff))}`;
    head = banner(r.ok, text);
    reportHead = `**${text}**\n\n`;
  } else if (check) {
    const r = evaluateCheck(check, res.table);
    ok = r.ok;
    const text = r.ok
      ? vscode.l10n.t('Check passed: {0}', describeCheck(check))
      : vscode.l10n.t('Check failed: {0} ({1} cells)', describeCheck(check), r.failureCount);
    const list = r.failures.map(f => `<li>${escapeHtml(f)}</li>`).join('');
    head = banner(r.ok, text) + (list ? `<ul style="margin:0 0 6px">${list}</ul>` : '');
    reportHead = [`**${text}**`, ...r.failures.map(f => `- ${f}`)].join('\n') + '\n\n';
  }
  return {
    ok,
    out: output(
      [vscode.NotebookCellOutputItem.text(`${head}<p style="opacity:.7">${escapeHtml(info)}</p>${cellsetToHtml(res.table)}`, 'text/html')],
      `${reportHead}_${info}_\n\n${cellsetToMarkdown(res.table)}`,
      { sum, stamp },
    ),
  };
}

async function runTiCell(serverId: string, source: string, token: vscode.CancellationToken): Promise<{ ok: boolean; out: vscode.NotebookCellOutput } | undefined> {
  const cfg = cfgOf(serverId);
  // MDX cells read the active sandbox; a TI cell would load into base, and the
  // checks after it would test numbers the load never touched.
  const sandbox = getActiveSandboxName(cfg);
  if (sandbox) {
    throw new Error(vscode.l10n.t(
      'Sandbox "{0}" is active: TI cells write to base data while MDX cells read the sandbox. Switch to Base to run TI cells.',
      sandbox));
  }
  const { result, cancelled } = await runCancellableProcess(
    vscode.l10n.t('TM1 Notebook'),
    TI_PROC_NAME,
    cfg,
    () => runTransientProcess(cfg, { name: TI_PROC_NAME, prolog: terminateTiSnippet(source) }),
    // The cell's Stop button must reach the server thread: aborting the client
    // wait alone leaves the TI running on TM1 (same rule as the Running view).
    { includeTransient: true, token },
  );
  if (cancelled || !result) { return undefined; }
  const text = [`${serverLabel(serverId)} · ${result.status || 'CompletedSuccessfully'}`, result.errorLog]
    .filter(Boolean).join('\n\n');
  return {
    ok: result.ok,
    out: output(
      [result.ok ? vscode.NotebookCellOutputItem.text(text) : vscode.NotebookCellOutputItem.stderr(text)],
      '```\n' + text + '\n```',
    ),
  };
}

async function runStatusCell(serverId: string, source: string): Promise<{ ok: boolean; out: vscode.NotebookCellOutput }> {
  const cfg = cfgOf(serverId);
  if (cfg.version === 'v12') {
    // v12 has no message log and writes a log file per run, not per failure.
    throw new Error(vscode.l10n.t('Status checks need TM1 11: v12 has no message log.'));
  }
  const lines = parseStatusLines(source);
  let errorFiles: string[] | undefined;
  let chores: Awaited<ReturnType<typeof fetchChoreRunStats>> | undefined;
  const rows: Array<{ ok: boolean; text: string; detail: string[] }> = [];
  for (const line of lines) {
    if (line.kind === 'invalid') {
      rows.push({ ok: false, text: line.text, detail: [
        vscode.l10n.t('Unknown line. Use "no errors since <when>" or "chore <name> ran since <when>".'),
      ] });
      continue;
    }
    const when = line.since.toLocaleString();
    if (line.kind === 'errors') {
      if (!errorFiles) {
        const res = await apiFor(serverId)('GET', 'ErrorLogFiles?$select=Filename');
        if (res.statusCode !== 200) { throw new Tm1HttpError(`ErrorLogFiles: HTTP ${res.statusCode}`, res.statusCode); }
        errorFiles = (parseBodySafe<{ value?: Array<{ Filename?: string }> }>(res, {}).value ?? [])
          .map(f => f.Filename ?? '').filter(Boolean);
      }
      const hits = errorLogsSince(errorFiles, line.since);
      rows.push({
        ok: hits.length === 0,
        text: hits.length
          ? vscode.l10n.t('{0} error logs since {1}', hits.length, when)
          : vscode.l10n.t('No error logs since {0}', when),
        detail: hits.slice(0, 20),
      });
      continue;
    }
    chores ??= await fetchChoreRunStats(cfg);
    if (chores.reason) {
      rows.push({ ok: false, text: line.text, detail: [vscode.l10n.t('Chore runs could not be read from the message log.')] });
      continue;
    }
    const r = choreRunSince(chores.runs ?? [], line.name, line.since.getTime());
    rows.push(r.state === 'finished'
      ? { ok: true, text: vscode.l10n.t('Chore {0} finished at {1}', line.name, new Date(r.endMs).toLocaleString()), detail: [] }
      : r.state === 'running'
        ? { ok: false, text: vscode.l10n.t('Chore {0} is still running (started {1})', line.name, new Date(r.startMs).toLocaleString()), detail: [] }
        : { ok: false, text: vscode.l10n.t('Chore {0} has not run since {1}', line.name, when), detail: [] });
  }
  const html = rows.map(r => banner(r.ok, r.text)
    + (r.detail.length ? `<ul style="margin:0 0 6px">${r.detail.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '')).join('');
  const report = rows.map(r => `- ${r.ok ? '✅' : '❌'} ${r.text}${r.detail.map(d => `\n  - ${d}`).join('')}`).join('\n');
  return {
    ok: rows.every(r => r.ok),
    out: output([vscode.NotebookCellOutputItem.text(html || '<p>-</p>', 'text/html')], report),
  };
}

/** `stop` = a TI step failed or was cancelled: later checks would test stale data. */
type CellOutcome = 'ok' | 'failed' | 'stop';

async function executeCell(
  controller: vscode.NotebookController,
  cell: vscode.NotebookCell,
  serverId: string,
): Promise<CellOutcome> {
  const exec = controller.createNotebookCellExecution(cell);
  const outcome = await runExecution(exec, cell, serverId);
  // Stop cancels the running cell's token only; the cells after it would start anyway.
  return exec.token.isCancellationRequested ? 'stop' : outcome;
}

async function runExecution(
  exec: vscode.NotebookCellExecution,
  cell: vscode.NotebookCell,
  serverId: string,
): Promise<CellOutcome> {
  exec.start(Date.now());
  await exec.clearOutput();
  stampByCell.set(cell.document, currentStamp(cell.notebook, serverId));
  const lang = cell.document.languageId;
  try {
    if (lang === PARAMS_CELL_LANGUAGE) {
      const text = Object.entries(parseParams(cell.document.getText())).map(([k, v]) => `{${k}} = ${v}`).join('\n');
      await exec.replaceOutput(output([vscode.NotebookCellOutputItem.text(text)], ''));
      exec.end(true, Date.now());
      return 'ok';
    }
    const source = applyParams(cell.document.getText(), notebookParams(cell.notebook),
      lang === TI_CELL_LANGUAGE ? 'ti' : lang === STATUS_CELL_LANGUAGE ? undefined : 'mdx');
    const res = lang === TI_CELL_LANGUAGE ? await runTiCell(serverId, source, exec.token)
      : lang === STATUS_CELL_LANGUAGE ? await runStatusCell(serverId, source)
        : await runMdxCell(serverId, source, cell);
    if (res) { await exec.replaceOutput(res.out); }
    exec.end(res?.ok ?? false, Date.now());
    if (!res || (!res.ok && lang === TI_CELL_LANGUAGE)) { return 'stop'; }
    return res.ok ? 'ok' : 'failed';
  } catch (e) {
    const message = errMsg(e);
    await exec.replaceOutput(output([vscode.NotebookCellOutputItem.error(new Error(message))], `\`${message}\``));
    exec.end(false, Date.now());
    return lang === TI_CELL_LANGUAGE ? 'stop' : 'failed';
  }
}

function functionItems(): vscode.CompletionItem[] {
  return ALL_FUNCTIONS.map(f => {
    const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
    item.insertText = new vscode.SnippetString(f.snippet);
    return item;
  });
}

function nameItems(names: string[], kind: vscode.CompletionItemKind, detail: string): vscode.CompletionItem[] {
  return names.map(n => Object.assign(new vscode.CompletionItem(n, kind), { detail }));
}

/**
 * VS Code twin of the MDX runner's Monaco provider
 * (`webviewClient/mdxRunnerMonaco/completion.ts`): same context parser, same
 * function list, same schema cache. Cubes and dimensions come only once the
 * notebook has a server; completion never opens the server picker.
 */
const mdxCompletion: vscode.CompletionItemProvider = {
  async provideCompletionItems(doc, pos) {
    const ctx = getMdxContext(doc.getText(), doc.offsetAt(pos));
    if (!ctx) { return []; }
    if (ctx.kind === 'function') {
      return [...nameItems(MDX_KEYWORDS, vscode.CompletionItemKind.Keyword, ''), ...functionItems()];
    }
    if (ctx.kind === 'memberFunction') {
      return [...nameItems(MEMBER_PROPERTIES, vscode.CompletionItemKind.Property, 'Member Property'), ...functionItems()];
    }
    const nb = vscode.workspace.notebookDocuments.find(n => n.getCells().some(c => c.document === doc));
    const serverId = nb && serverByNotebook.get(nb.uri.toString());
    const cfg = serverId && getServerConfig(serverId);
    if (!serverId || !cfg) { return []; }
    try {
      if (ctx.kind === 'member') {
        const names = await getElementNames(ctx.dim, cfg, apiFor(serverId), ctx.hier ?? undefined);
        // Replace everything after `[` — element names carry spaces the word range would cut.
        const range = new vscode.Range(pos.translate(0, -ctx.prefix.length), pos);
        return pickMembers(names, ctx.prefix).map(n => Object.assign(
          new vscode.CompletionItem(n, vscode.CompletionItemKind.EnumMember),
          { insertText: escapeMdx(n), range, detail: ctx.hier ? `${ctx.dim}:${ctx.hier}` : ctx.dim },
        ));
      }
      if (ctx.kind === 'cube') {
        return nameItems(await getCubes(cfg, apiFor(serverId)), vscode.CompletionItemKind.Class, 'Cube');
      }
      return ctx.cube
        ? nameItems(await getCubeDims(ctx.cube, cfg, apiFor(serverId)), vscode.CompletionItemKind.Module, ctx.cube)
        : [];
    } catch {
      return [];
    }
  },
};

/** Summary after a run of several cells; offers the report. */
async function showSummary(nb: vscode.NotebookDocument, outcomes: Array<[vscode.NotebookCell, CellOutcome]>): Promise<void> {
  const checked = outcomes.filter(([c]) => c.document.languageId !== PARAMS_CELL_LANGUAGE);
  if (checked.length < 2) { return; }
  const bad = checked.filter(([, o]) => o !== 'ok').map(([c]) => String(c.index + 1));
  const passed = checked.length - bad.length;
  const exportLabel = vscode.l10n.t('Export Report');
  const pick = bad.length
    ? await vscode.window.showWarningMessage(
      vscode.l10n.t('Notebook: {0} passed, {1} failed (cells {2}).', passed, bad.length, bad.join(', ')), exportLabel)
    : await vscode.window.showInformationMessage(vscode.l10n.t('Notebook: all {0} cells passed.', passed), exportLabel);
  if (pick === exportLabel) { await exportReport(nb); }
}

async function exportReport(nb: vscode.NotebookDocument): Promise<void> {
  const serverId = serverByNotebook.get(nb.uri.toString());
  const cfg = serverId ? getServerConfig(serverId) : undefined;
  const stamp = serverId && cfg ? currentStamp(nb, serverId) : undefined;
  const cells: ReportCell[] = nb.getCells().map(c => {
    if (c.kind === vscode.NotebookCellKind.Markup) { return { kind: 'markdown', source: c.document.getText() }; }
    // Ran under another server, sandbox or parameters than the header shows: not run for this report.
    const current = stamp !== undefined && stampByCell.get(c.document) === stamp;
    return {
      kind: 'code',
      language: c.document.languageId,
      source: c.document.getText(),
      ok: current ? c.executionSummary?.success : undefined,
      result: current ? c.outputs[0]?.metadata?.report as string | undefined : undefined,
    };
  });
  const name = nb.uri.path.split('/').pop()?.replace(/\.tm1nb$/i, '') || 'notebook';
  const md = buildReport(
    {
      title: name,
      server: serverId ? serverLabel(serverId) : '-',
      user: cfg?.username || '-',
      date: new Date().toLocaleString(),
      params: notebookParams(nb),
    },
    cells,
    {
      title: vscode.l10n.t('Notebook report'),
      server: vscode.l10n.t('Server'),
      user: vscode.l10n.t('User'),
      date: vscode.l10n.t('Date'),
      parameters: vscode.l10n.t('Parameters'),
      summary: vscode.l10n.t('Result'),
      passed: vscode.l10n.t('passed'),
      failed: vscode.l10n.t('failed'),
      notRun: vscode.l10n.t('not run'),
    },
  );
  const fileName = `${name}-${new Date().toISOString().slice(0, 10)}.md`;
  const target = await vscode.window.showSaveDialog({
    defaultUri: nb.uri.scheme === 'file' ? vscode.Uri.joinPath(nb.uri, '..', fileName) : undefined,
    filters: { Markdown: ['md'] },
  });
  if (!target) { return; }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(md));
  await vscode.window.showTextDocument(target);
}

export function registerTm1Notebook(context: vscode.ExtensionContext): void {
  const controller = vscode.notebooks.createNotebookController(NOTEBOOK_TYPE, NOTEBOOK_TYPE, 'TM1');
  controller.supportedLanguages = [MDX_CELL_LANGUAGE, TI_CELL_LANGUAGE, STATUS_CELL_LANGUAGE, PARAMS_CELL_LANGUAGE];
  controller.supportsExecutionOrder = false;
  controller.executeHandler = async (cells, nb) => {
    const serverId = await serverFor(nb);
    if (!serverId) { return; }
    // Sequential. A failed check does not stop the run — the checklist wants
    // every red cell — but a failed TI step does: checks after a broken load
    // would test stale numbers.
    const outcomes: Array<[vscode.NotebookCell, CellOutcome]> = [];
    for (const cell of cells) {
      const outcome = await executeCell(controller, cell, serverId);
      outcomes.push([cell, outcome]);
      if (outcome === 'stop') { break; }
    }
    void showSummary(nb, outcomes);
  };

  context.subscriptions.push(
    controller,
    vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, new Tm1NotebookSerializer(), { transientOutputs: true }),
    vscode.languages.registerCompletionItemProvider({ language: MDX_CELL_LANGUAGE }, mdxCompletion, '[', '.'),
    // Same formatter as the runner's Shift+Alt+F.
    vscode.languages.registerDocumentFormattingEditProvider({ language: MDX_CELL_LANGUAGE }, {
      provideDocumentFormattingEdits(doc) {
        const text = doc.getText();
        const formatted = formatMdx(text);
        return formatted === text ? [] : [vscode.TextEdit.replace(new vscode.Range(0, 0, doc.lineCount, 0), formatted)];
      },
    }),
    vscode.workspace.onDidCloseNotebookDocument(nb => serverByNotebook.delete(nb.uri.toString())),
    // From the server context menu the node names the server; from the
    // palette the first run asks.
    vscode.commands.registerCommand('tm1.notebook.new', async (node?: { meta?: { serverId?: unknown } }) => {
      const picks: Array<vscode.QuickPickItem & { id: TemplateId }> = [
        { id: 'closing', label: vscode.l10n.t('Month-end closing checklist'),
          description: vscode.l10n.t('Load, job status, reconciliation, open items') },
        { id: 'example', label: vscode.l10n.t('Example'), description: vscode.l10n.t('Every cell kind and check, runs on any server') },
        { id: 'empty', label: vscode.l10n.t('Empty notebook') },
      ];
      const pick = await vscode.window.showQuickPick(picks, { placeHolder: vscode.l10n.t('Choose a template') });
      if (!pick) { return; }
      const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, toNotebookData(TEMPLATES[pick.id]));
      if (typeof node?.meta?.serverId === 'string') { serverByNotebook.set(doc.uri.toString(), node.meta.serverId); }
      await vscode.window.showNotebookDocument(doc);
    }),
    vscode.commands.registerCommand('tm1.notebook.exportReport', async () => {
      const nb = vscode.window.activeNotebookEditor?.notebook;
      if (nb) { await exportReport(nb); }
    }),
    vscode.commands.registerCommand('tm1.notebook.selectServer', async () => {
      const nb = vscode.window.activeNotebookEditor?.notebook;
      if (!nb) { return; }
      // Replace the binding only on a pick: Escape keeps it, so a later run
      // still asks when that server is gone instead of taking the last one left.
      const picked = await serverIdForCommand(undefined, { alwaysAsk: true });
      if (picked) { serverByNotebook.set(nb.uri.toString(), picked); }
    }),
  );
}
