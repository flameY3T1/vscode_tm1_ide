// src/notebook/notebookPure.ts
// File format and result rendering for the TM1 notebook (`*.tm1nb`).
// No `vscode` import: the serializer and the controller in `tm1Notebook.ts`
// translate between these plain shapes and the notebook API.

import type { CellsetTable } from '../mdx/cellsetParser';
import { escapeHtml } from '../utils/escapeHtml';
import { escapeMdx, escapeODataKey } from '../utils/odataKey';

export const MDX_CELL_LANGUAGE = 'tm1mdx';
export const TI_CELL_LANGUAGE = 'ti';

/** One cell on disk. Outputs are not stored: a notebook in git stays a clean diff. */
export interface NotebookFileCell {
  kind: 'markdown' | 'code';
  /** Only for code cells: `tm1mdx` or `ti`. */
  language?: string;
  source: string;
}

export interface NotebookFile {
  cells: NotebookFileCell[];
}

/** Empty or broken file = empty notebook, so a fresh `*.tm1nb` opens instead of failing. */
export function parseNotebookFile(text: string): NotebookFile {
  if (text.trim() === '') { return { cells: [] }; }
  const raw = JSON.parse(text) as { cells?: unknown };
  const cells = Array.isArray(raw.cells) ? raw.cells : [];
  return {
    cells: cells.map((c: Partial<NotebookFileCell>) => ({
      kind: c.kind === 'markdown' ? 'markdown' : 'code',
      language: c.kind === 'markdown' ? undefined : (c.language || MDX_CELL_LANGUAGE),
      source: typeof c.source === 'string' ? c.source : '',
    })),
  };
}

export function stringifyNotebookFile(file: NotebookFile): string {
  return JSON.stringify(file, null, 2) + '\n';
}

function headerRows(hierarchies: string[], tuples: string[][], rowHierCount: number): string {
  // One header row per column hierarchy; the corner spans the row-header columns.
  return hierarchies.map((h, level) => {
    const corner = `<th colspan="${Math.max(rowHierCount, 1)}">${escapeHtml(h)}</th>`;
    const cells = tuples.map(t => `<th>${escapeHtml(t[level] ?? '')}</th>`).join('');
    return `<tr>${corner}${cells}</tr>`;
  }).join('');
}

/** Cellset as a plain HTML table for a `text/html` cell output. */
export function cellsetToHtml(table: CellsetTable): string {
  const titles = table.titleHeaders.length
    ? `<p>${table.titleHeaders.map(t => `${escapeHtml(t.hierarchy)}: <b>${escapeHtml(t.member)}</b>`).join(' · ')}</p>`
    : '';
  const head = headerRows(table.colHierarchies, table.colHeaders, table.rowHierarchies.length);
  const body = table.cells.map((row, r) => {
    const rowHead = (table.rowHeaders[r] ?? []).map(m => `<th>${escapeHtml(m)}</th>`).join('')
      || '<th></th>';
    const vals = row.map(c => {
      const numeric = typeof c.value === 'number';
      return `<td${numeric ? ' style="text-align:right"' : ''}>${escapeHtml(shownValue(c))}</td>`;
    }).join('');
    return `<tr>${rowHead}${vals}</tr>`;
  }).join('');
  const style = '<style>table.tm1nb{border-collapse:collapse;font-size:12px}'
    + 'table.tm1nb th,table.tm1nb td{border:1px solid rgba(128,128,128,.35);padding:2px 6px;white-space:nowrap}'
    + 'table.tm1nb th{text-align:left;font-weight:600}</style>';
  return `${style}${titles}<table class="tm1nb">${head}${body}</table>`;
}

// ── Parameters ──────────────────────────────────────────────────────────────

export const PARAMS_CELL_LANGUAGE = 'tm1params';

/** `Name = Value` per line; `#`, `//` and `--` start a comment line. Later lines win. */
export function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#') || t.startsWith('//') || t.startsWith('--')) { continue; }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(t);
    if (m) { out[m[1]] = m[2].trim(); }
  }
  return out;
}

/**
 * Replaces `{Name}` for DEFINED parameters only (case-insensitive name). An
 * MDX set like `{[Month].[Jan]}` or an undefined `{Foo}` stays as written.
 *
 * With `escape`, a value that lands inside an MDX `[...]` name gets `]` as
 * `]]`, one inside a TI `'...'` string gets `'` as `''`. Outside those the
 * value is inserted as written — it may be a whole expression on purpose.
 * The quote state restarts on every line (neither form spans lines).
 */
export function applyParams(text: string, params: Record<string, string>, escape?: 'mdx' | 'ti'): string {
  const byLower = new Map(Object.entries(params).map(([k, v]) => [k.toLowerCase(), v]));
  if (byLower.size === 0) { return text; }
  let scanned = 0;
  let quoted = false;
  const advance = (to: number) => {
    for (; scanned < to; scanned++) {
      const c = text[scanned];
      if (c === '\n') { quoted = false; } else if (escape === 'ti' && c === "'") { quoted = !quoted; } else if (escape === 'mdx') {
        if (!quoted && c === '[') { quoted = true; } else if (quoted && c === ']') {
          if (text[scanned + 1] === ']') { scanned++; } else { quoted = false; }
        }
      }
    }
  };
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name: string, offset: number) => {
    const value = byLower.get(name.toLowerCase());
    if (value === undefined) { return all; }
    advance(offset);
    scanned = offset + all.length;
    if (!quoted) { return value; }
    return escape === 'mdx' ? escapeMdx(value) : escapeODataKey(value); // TI doubles `'` the same way
  });
}

/**
 * The formatted value, or the raw number when the format hides digits
 * (`1234567.37` instead of `1.234.567`): checks compare the raw number, so it
 * must be visible to write one. Compared are the significant digits, without
 * leading and trailing zeros, so padding (`1,234.50`), percent (`50%`) and
 * float noise (`1234.5600000000002`) do not count as hidden.
 */
export function shownValue(c: { value: number | string | null; formatted: string }): string {
  if (typeof c.value !== 'number' || !c.formatted) { return c.formatted; }
  const raw = String(Number(c.value.toPrecision(15)));
  const sig = (s: string) => s.replace(/\D/g, '').replace(/^0+|0+$/g, '');
  return sig(c.formatted) === sig(raw) ? c.formatted : raw;
}

// ── Checks ──────────────────────────────────────────────────────────────────

export type CheckOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type Check =
  | { kind: 'empty' }
  /** `tol` only with `=`: the cell may differ from `value` by at most `tol`. */
  | { kind: 'compare'; op: CheckOp; value: number; abs: boolean; tol?: number }
  /** Sum of this cell's numbers equals the sum of the cell named `ref`, within `tol`. */
  | { kind: 'reconcile'; ref: string; tol: number };

const CHECK_LINE = /^[ \t]*(?:\/\/|--)[ \t]*check:[ \t]*(.*)$/im;
const NAME_LINE = /^[ \t]*(?:\/\/|--)[ \t]*name:[ \t]*(.*)$/im;

/** `// name: source` — lets another cell reconcile against this one. */
export function parseCellName(text: string): string | undefined {
  const m = NAME_LINE.exec(text);
  const name = m?.[1].trim();
  return name ? name : undefined;
}

/**
 * `// check: empty` — the result has no rows.
 * `// check: zero` — every numeric cell is 0 (same as `= 0`).
 * `// check: [abs] <op> <number>` — every numeric cell passes, e.g. `abs < 0.01`.
 * `// check: = <number> ± <tol>` — every numeric cell is within `tol` of the number.
 * `undefined` = no check line; `string` = check line that does not parse.
 */
export function parseCheck(text: string): Check | string | undefined {
  const line = CHECK_LINE.exec(text);
  if (!line) { return undefined; }
  const body = line[1].trim();
  if (/^empty$/i.test(body)) { return { kind: 'empty' }; }
  if (/^zero$/i.test(body)) { return { kind: 'compare', op: '=', value: 0, abs: false }; }
  const rec = /^=\s*([A-Za-z_][\w.-]*)\s*(?:(?:±|\+-|\+\/-)\s*(\d+(?:[.,]\d+)?))?$/.exec(body);
  if (rec) { return { kind: 'reconcile', ref: rec[1], tol: rec[2] ? Number(rec[2].replace(',', '.')) : 0 }; }
  const near = /^=\s*(-?\d+(?:[.,]\d+)?)\s*(?:±|\+-|\+\/-)\s*(\d+(?:[.,]\d+)?)$/.exec(body);
  if (near) {
    return { kind: 'compare', op: '=', value: Number(near[1].replace(',', '.')), abs: false, tol: Number(near[2].replace(',', '.')) };
  }
  const m = /^(abs\s+)?(<>|!=|<=|>=|=|<|>)\s*(-?\d+(?:[.,]\d+)?)$/i.exec(body);
  if (!m) { return body; }
  const op = (m[2] === '<>' ? '!=' : m[2]) as CheckOp;
  return { kind: 'compare', op, value: Number(m[3].replace(',', '.')), abs: !!m[1] };
}

/** Check and name lines are not MDX — they are removed before the query goes to TM1. */
export function stripCheckLine(text: string): string {
  return text.replace(new RegExp(CHECK_LINE.source, 'gim'), '').replace(new RegExp(NAME_LINE.source, 'gim'), '');
}

export function describeCheck(c: Check): string {
  if (c.kind === 'empty') { return 'empty'; }
  if (c.kind === 'reconcile') { return `= ${c.ref}${c.tol ? ` ± ${c.tol}` : ''}`; }
  return `${c.abs ? 'abs ' : ''}${c.op} ${c.value}${c.tol ? ` ± ${c.tol}` : ''}`;
}

/** Sum of all numeric cells; empty cells count as 0, strings are skipped. */
export function tableSum(table: CellsetTable): number {
  let sum = 0;
  for (const row of table.cells) {
    for (const c of row) { if (typeof c.value === 'number') { sum += c.value; } }
  }
  return sum;
}

/**
 * What a cell's sum was computed against: server and parameter values. Stored
 * next to the sum; a reconcile only trusts a sum whose stamp matches the
 * current run, otherwise it would compare against another server's numbers.
 */
export function runStamp(serverId: string, params: Record<string, string>, sandbox?: string): string {
  return JSON.stringify([serverId, sandbox ?? '', Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
}

/** Sum from a named cell's output metadata: `missing` = not run, `stale` = other server, sandbox or parameters. */
export function storedSum(meta: { sum?: unknown; stamp?: unknown } | undefined, stamp: string): number | 'missing' | 'stale' {
  if (typeof meta?.sum !== 'number') { return 'missing'; }
  return meta.stamp === stamp ? meta.sum : 'stale';
}

export interface ReconcileResult { ok: boolean; own: number; other: number; diff: number }

export function reconcile(own: number, other: number, tol: number): ReconcileResult {
  const diff = own - other;
  // Float sums of many cells drift in the last digits; an exact check (no
  // tolerance written) allows 1e-13 relative for that. A written tolerance
  // is taken as is: the allowance would outgrow it on large sums (0.1 at 1e12).
  const allowed = tol > 0 ? tol : 1e-13 * Math.max(1, Math.abs(own), Math.abs(other));
  return { ok: Math.abs(diff) <= allowed, own, other, diff };
}

export interface CheckResult {
  ok: boolean;
  /** Failing cells as `row / column: value`, capped at `CHECK_FAILURES_MAX`. */
  failures: string[];
  failureCount: number;
}

export const CHECK_FAILURES_MAX = 20;

function compare(op: CheckOp, a: number, b: number): boolean {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
}

/** For `empty` and `compare`; `reconcile` needs the other cell and is evaluated by the caller. */
export function evaluateCheck(check: Exclude<Check, { kind: 'reconcile' }>, table: CellsetTable): CheckResult {
  const failures: string[] = [];
  let failureCount = 0;
  const label = (r: number, c: number) =>
    `${(table.rowHeaders[r] ?? []).join(' / ') || '-'} | ${(table.colHeaders[c] ?? []).join(' / ') || '-'}`;
  if (check.kind === 'empty') {
    // Tuples on the row axis; a query with columns only counts its columns.
    const tuples = table.rowHierarchies.length ? table.rowHeaders : table.colHeaders;
    for (const t of tuples) {
      failureCount++;
      if (failures.length < CHECK_FAILURES_MAX) { failures.push(t.join(' / ')); }
    }
    return { ok: failureCount === 0, failures, failureCount };
  }
  table.cells.forEach((row, r) => row.forEach((cell, c) => {
    // A string cell is never checked; an empty numeric cell counts as 0.
    if (typeof cell.value === 'string') { return; }
    const raw = cell.value ?? 0;
    const v = check.abs ? Math.abs(raw) : raw;
    const ok = check.tol ? Math.abs(v - check.value) <= check.tol : compare(check.op, v, check.value);
    if (!ok) {
      failureCount++;
      if (failures.length < CHECK_FAILURES_MAX) { failures.push(`${label(r, c)}: ${shownValue(cell) || raw}`); }
    }
  }));
  return { ok: failureCount === 0, failures, failureCount };
}

// ── Report ──────────────────────────────────────────────────────────────────

const MD_ROWS_MAX = 200;

function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Cellset as a Markdown table for the report, capped at `MD_ROWS_MAX` rows. */
export function cellsetToMarkdown(table: CellsetTable): string {
  const rowHeadCols = Math.max(table.rowHierarchies.length, 1);
  const head = [
    ...Array.from({ length: rowHeadCols }, (_, i) => table.rowHierarchies[i] ?? ''),
    ...table.colHeaders.map(t => t.join(' / ')),
  ];
  const lines = [
    `| ${head.map(mdCell).join(' | ')} |`,
    `| ${head.map((_, i) => (i < rowHeadCols ? '---' : '---:')).join(' | ')} |`,
  ];
  table.cells.slice(0, MD_ROWS_MAX).forEach((row, r) => {
    const rh = Array.from({ length: rowHeadCols }, (_, i) => table.rowHeaders[r]?.[i] ?? '');
    lines.push(`| ${[...rh, ...row.map(shownValue)].map(mdCell).join(' | ')} |`);
  });
  if (table.cells.length > MD_ROWS_MAX) { lines.push('', `… ${table.cells.length - MD_ROWS_MAX} more rows`); }
  return lines.join('\n');
}

export interface ReportCell {
  kind: 'markdown' | 'code';
  language?: string;
  source: string;
  /** `undefined` = not run in this session. */
  ok?: boolean;
  /** Markdown the run left for the report (table, check result, TI status). */
  result?: string;
}

export interface ReportLabels {
  title: string;
  server: string;
  user: string;
  date: string;
  parameters: string;
  summary: string;
  passed: string;
  failed: string;
  notRun: string;
}

export function buildReport(
  meta: { title: string; server: string; user: string; date: string; params: Record<string, string> },
  cells: ReportCell[],
  L: ReportLabels,
): string {
  const code = cells.filter(c => c.kind === 'code' && c.language !== PARAMS_CELL_LANGUAGE);
  const passed = code.filter(c => c.ok === true).length;
  const failed = code.filter(c => c.ok === false).length;
  const out: string[] = [
    `# ${L.title}: ${meta.title}`,
    '',
    `- ${L.server}: ${meta.server}`,
    `- ${L.user}: ${meta.user}`,
    `- ${L.date}: ${meta.date}`,
    `- ${L.summary}: ${passed} ${L.passed}, ${failed} ${L.failed}, ${code.length - passed - failed} ${L.notRun}`,
  ];
  const paramEntries = Object.entries(meta.params);
  if (paramEntries.length) {
    out.push(`- ${L.parameters}: ${paramEntries.map(([k, v]) => `${k} = ${v}`).join(', ')}`);
  }
  for (const c of cells) {
    out.push('');
    if (c.kind === 'markdown') { out.push(c.source); continue; }
    if (c.language === PARAMS_CELL_LANGUAGE) { continue; }
    const mark = c.ok === undefined ? `⏸ ${L.notRun}` : c.ok ? `✅ ${L.passed}` : `❌ ${L.failed}`;
    const fence = c.language === TI_CELL_LANGUAGE ? 'ti' : c.language === STATUS_CELL_LANGUAGE ? 'text' : 'mdx';
    out.push(`**${mark}**`, '', '```' + fence, c.source.trimEnd(), '```');
    if (c.result) { out.push('', c.result); }
  }
  return out.join('\n') + '\n';
}

// ── Status cells ────────────────────────────────────────────────────────────

export const STATUS_CELL_LANGUAGE = 'tm1status';

export type StatusLine =
  | { kind: 'errors'; since: Date; text: string }
  | { kind: 'chore'; name: string; since: Date; text: string }
  | { kind: 'invalid'; text: string };

/**
 * `today`, `yesterday`, `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`, in local time.
 * `undefined` for anything else.
 */
export function parseSince(s: string, now = new Date()): Date | undefined {
  const t = s.trim().toLowerCase();
  if (t === 'today' || t === 'yesterday') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (t === 'yesterday') { d.setDate(d.getDate() - 1); }
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(t);
  if (!m) { return undefined; }
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  return Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1 ? undefined : d;
}

/**
 * One statement per line; `#`, `//` and `--` start a comment line:
 *   no errors since <when>
 *   chore <name> ran since <when>
 */
export function parseStatusLines(text: string, now = new Date()): StatusLine[] {
  const out: StatusLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#') || t.startsWith('//') || t.startsWith('--')) { continue; }
    const err = /^no\s+errors\s+since\s+(.+)$/i.exec(t);
    const chore = /^chore\s+(.+?)\s+ran\s+since\s+(.+)$/i.exec(t);
    const since = parseSince((err?.[1] ?? chore?.[2] ?? ''), now);
    if (err && since) { out.push({ kind: 'errors', since, text: t }); continue; }
    if (chore && since) { out.push({ kind: 'chore', name: chore[1].replace(/^["']|["']$/g, ''), since, text: t }); continue; }
    out.push({ kind: 'invalid', text: t });
  }
  return out;
}

function pad(n: number, w = 2): string { return String(n).padStart(w, '0'); }

/**
 * v11 error logs are named `TM1ProcessError_<YYYYMMDDHHMMSS>_<pid>_<process>.log`,
 * stamped in server-local time. Comparing the digits against the local `since`
 * needs no time-zone guess as long as client and server share one — the usual
 * setup. Returns the matching file names, newest first.
 */
export function errorLogsSince(fileNames: string[], since: Date): string[] {
  const floor = `${since.getFullYear()}${pad(since.getMonth() + 1)}${pad(since.getDate())}`
    + `${pad(since.getHours())}${pad(since.getMinutes())}00`;
  return fileNames
    .map(f => ({ f, stamp: /^TM1ProcessError_(\d{14})_/.exec(f)?.[1] }))
    .filter((x): x is { f: string; stamp: string } => !!x.stamp && x.stamp >= floor)
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
    .map(x => x.f);
}

export type ChoreSince =
  | { state: 'finished'; endMs: number }
  | { state: 'running'; startMs: number }
  | { state: 'none' };

/** Latest run of `name` (case-insensitive) that started or ended after `sinceMs`. */
export function choreRunSince(
  runs: ReadonlyArray<{ name: string; startMs: number; endMs?: number }>,
  name: string,
  sinceMs: number,
): ChoreSince {
  const mine = runs
    .filter(r => r.name.toLowerCase() === name.toLowerCase() && (r.endMs ?? r.startMs) >= sinceMs)
    .sort((a, b) => b.startMs - a.startMs);
  const last = mine[0];
  if (!last) { return { state: 'none' }; }
  return last.endMs !== undefined ? { state: 'finished', endMs: last.endMs } : { state: 'running', startMs: last.startMs };
}

// ── Templates ───────────────────────────────────────────────────────────────

export type TemplateId = 'closing' | 'example' | 'empty';

const md = (source: string): NotebookFileCell => ({ kind: 'markdown', source });
const code = (language: string, source: string): NotebookFileCell => ({ kind: 'code', language, source });

export const TEMPLATES: Record<TemplateId, NotebookFileCell[]> = {
  closing: [
    md('# Month-end closing {Year}-{Month}\n\nRun top to bottom. Every red cell needs a look before sign-off. '
      + 'Replace cube, dimension and process names with your own.'),
    code(PARAMS_CELL_LANGUAGE, '# Name = Value, used as {Name} in every cell\nYear = 2026\nMonth = 09\nVersion = Actual'),
    md('## 1. Load'),
    code(TI_CELL_LANGUAGE, "# A failed TI cell stops \"Run All\": checks after a broken load would test stale numbers.\n"
      + "# ExecuteProcess('Load.Actuals', 'pYear', '{Year}', 'pMonth', '{Month}');"),
    md('## 2. Did the jobs run cleanly?'),
    code(STATUS_CELL_LANGUAGE, '# no errors since <today | yesterday | YYYY-MM-DD [HH:MM]>\n'
      + '# chore <name> ran since <...>\nno errors since today\n# chore Nightly.Load ran since today'),
    md('## 3. Reconcile source and target'),
    code(MDX_CELL_LANGUAGE, '// name: source\n'
      + 'SELECT {[Version].[{Version}]} ON 0\nFROM [Source]\nWHERE ([Year].[{Year}], [Month].[{Month}])'),
    code(MDX_CELL_LANGUAGE, '// check: = source ± 0.01\n'
      + 'SELECT {[Version].[{Version}]} ON 0\nFROM [Target]\nWHERE ([Year].[{Year}], [Month].[{Month}])'),
    md('## 4. Open items'),
    code(MDX_CELL_LANGUAGE, '// check: empty\n'
      + 'SELECT NON EMPTY {TM1FILTERBYLEVEL({TM1SUBSETALL([Account])}, 0)} ON 0\nFROM [Suspense]\n'
      + 'WHERE ([Year].[{Year}], [Month].[{Month}], [Version].[{Version}])'),
  ],
  // Runs on any server: the MDX cells compute their numbers as calculated
  // members on }ClientGroups, the TI cell only logs, the status cell only reads.
  example: [
    md('# Notebook examples\n\n'
      + 'Every cell kind and every check, runnable on any server. "Run All" goes top to bottom; '
      + 'one cell is red on purpose. Export the result with "Export Report".\n\n'
      + 'Cell kinds: **parameters** (`Name = Value`), **TI** (runs as an unbound process), '
      + '**status** (error logs, chore runs) and **MDX** (a table, optionally checked).'),
    md('## Server\n\n'
      + 'The file names no server, so the same notebook runs against dev or prod. The first run asks which '
      + 'connected server to use; the choice holds while the notebook is open. "Select Server" in the notebook '
      + 'toolbar switches it. If that server is disconnected, the next run asks again instead of silently '
      + 'taking another one.'),
    md('## Parameters\n\n'
      + '`{Name}` is replaced in every cell before it runs, check lines included. In MDX a `]` in the value '
      + 'is doubled, in TI a `\'`. Parameter cells apply to the whole notebook, wherever they stand; '
      + 'on equal names the lower cell wins. Names are case-insensitive. A `{Name}` without a parameter of '
      + 'that name stays as written, so an MDX set like `{[Month].[Jan]}` is safe. Markdown cells are not '
      + 'replaced.'),
    code(PARAMS_CELL_LANGUAGE, '# Name = Value, used as {Name} in every cell\nGroup = ADMIN\nTarget = 1234567'),
    md('## TI\n\n'
      + 'A TI cell runs as an unbound process. A failed TI cell stops "Run All": checks after a broken '
      + 'load would test stale numbers. TI cells refuse to run while a sandbox is active, because TI '
      + 'writes to base data while MDX cells read the sandbox. Stopping a running TI cell stops "Run All" too.'),
    code(TI_CELL_LANGUAGE, "LogOutput('INFO', 'Notebook example for group {Group}');"),
    md('## Status\n\n'
      + 'One statement per line; `#`, `//` and `--` start a comment. `<when>` is `today`, `yesterday`, '
      + '`YYYY-MM-DD` or `YYYY-MM-DD HH:MM`. Status cells need TM1 11: v12 has no message log, so they '
      + 'fail there.'),
    code(STATUS_CELL_LANGUAGE, '# no errors since <when>   no TM1ProcessError log since then\n'
      + '# chore <name> ran since <when>   the chore started or ended since then\n'
      + 'no errors since today\n# chore Nightly.Load ran since yesterday'),
    md('## Checks\n\n'
      + 'A `// check:` line (or `-- check:`) turns an MDX cell green or red. `empty`, `zero` and '
      + '`<op> <number>` test **every numeric cell on its own**, not their sum; string cells are skipped, '
      + 'empty cells count as 0. Operators: `=`, `<>` or `!=`, `<`, `<=`, `>`, `>=`. A decimal comma works too. '
      + 'One check line per cell. The check line and a `// name:` line are removed before the query goes to '
      + 'TM1. A result above 50,000 cells is refused: narrow the query.'),
    md('### A fixed number, with a tolerance\n\n'
      + 'The check compares the raw value, not the formatted one. When the format hides digits, the table '
      + 'shows the exact number, so you can see what the check sees. `± 0.5` accepts everything that rounds '
      + 'to the target; `+-` and `+/-` are the same.'),
    code(MDX_CELL_LANGUAGE, '// check: = {Target} ± 0.5\n'
      + "WITH MEMBER [}Clients].[Amount] AS 1234567.37, FORMAT_STRING = '#,##0'\n"
      + 'SELECT {[}Clients].[Amount]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('### The same without a tolerance: red on purpose\n\n'
      + 'The raw value is 1234567.37, so `= 1234567` fails. The failure list shows the exact value.'),
    code(MDX_CELL_LANGUAGE, '// check: = {Target}\n'
      + "WITH MEMBER [}Clients].[Amount] AS 1234567.37, FORMAT_STRING = '#,##0'\n"
      + 'SELECT {[}Clients].[Amount]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('### Every cell within a band\n\n'
      + '`abs` compares the absolute value: `abs < 0.01` means "between -0.01 and 0.01" for every cell.'),
    code(MDX_CELL_LANGUAGE, '// check: abs < 0.01\n'
      + 'WITH MEMBER [}Clients].[Diff] AS 0.004\n'
      + 'MEMBER [}Clients].[Other] AS -0.002\n'
      + 'SELECT {[}Clients].[Diff], [}Clients].[Other]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('### Zero and not equal\n\n`zero` is short for `= 0`.'),
    code(MDX_CELL_LANGUAGE, '// check: zero\n'
      + 'WITH MEMBER [}Clients].[Balance] AS 0\n'
      + 'SELECT {[}Clients].[Balance]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    code(MDX_CELL_LANGUAGE, '-- check: <> 0\n'
      + 'WITH MEMBER [}Clients].[Count] AS 42\n'
      + 'SELECT {[}Clients].[Count]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('### Lower and upper bounds\n\n'
      + '`>= 0` catches negative values, `< 100` a share above 100 %. For a band like "between 0 and 100", '
      + 'use one cell per bound, or `= 50 ± 50`.'),
    code(MDX_CELL_LANGUAGE, '// check: >= 0\n'
      + 'WITH MEMBER [}Clients].[Stock] AS 17\n'
      + 'SELECT {[}Clients].[Stock]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    code(MDX_CELL_LANGUAGE, '// check: < 100\n'
      + 'WITH MEMBER [}Clients].[Share] AS 87.5\n'
      + 'SELECT {[}Clients].[Share]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('### Nothing left over\n\n'
      + '`empty` passes when the result has no rows, e.g. a `NON EMPTY` query on a suspense account.'),
    code(MDX_CELL_LANGUAGE, '// check: empty\nSELECT {} ON 0 FROM [}ClientGroups]'),
    md('## Reconcile two cells\n\n'
      + '`// name: <name>` marks a cell; `// check: = <name> [± <tolerance>]` compares the **sum** of all '
      + 'numeric cells on both sides. Run the named cell first. If it ran against another server, sandbox '
      + 'or other parameters, the check stops with an error instead of comparing stale numbers.'),
    code(MDX_CELL_LANGUAGE, '// name: source\n'
      + 'WITH MEMBER [}Clients].[A] AS 100\n'
      + 'MEMBER [}Clients].[B] AS 23.5\n'
      + 'SELECT {[}Clients].[A], [}Clients].[B]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    code(MDX_CELL_LANGUAGE, '// check: = source ± 0.01\n'
      + 'WITH MEMBER [}Clients].[Total] AS 123.495\n'
      + 'SELECT {[}Clients].[Total]} ON 0\nFROM [}ClientGroups]\nWHERE ([}Groups].[{Group}])'),
    md('## After the run\n\n'
      + 'After "Run All" a message counts passed and failed cells and names the red ones. "Export Report" '
      + '(message or notebook toolbar) writes a Markdown report: server, user, date, parameters, then every '
      + 'cell with its source, result and pass/fail mark. Cells that did not run are marked as such.\n\n'
      + 'While typing MDX, completion suggests MDX functions and keywords, and once the notebook has a server '
      + 'also cubes, dimensions and elements.'),
  ],
  empty: [code(MDX_CELL_LANGUAGE, '')],
};
