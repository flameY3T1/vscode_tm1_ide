/**
 * One report, two renderers (HTML, Markdown), two cuts (full, management extract). Both
 * cuts come from the same `Analysis`, so the extract cannot show other numbers than the
 * full report (spec 1.1, 7.3). Texts arrive as `ReportL10n` from the host — this module
 * has no vscode.
 */
import { CATALOG_AS_OF, IBM_CHANGED_URL, IBM_DEPRECATED_URL } from './catalogPure';
import type { Analysis, CauseGroup, ObjectKind, Occurrence, RuleId, ScanInput } from './types';
import { USAGE_STATUSES, causeId, usageId, type Comparison, type Decision } from './assessmentPure';

/**
 * Saved state: which causes are known false alarms, which unused processes are to be
 * retired, and the comparison with the saved baseline. Owners, tasks and effort belong in
 * the consultant's own tools (decision 2026-10-07) — the Markdown export feeds them.
 */
export interface ReportState {
  decisions: Record<string, Decision>;
  comparison?: Comparison;
}

export interface ReportL10n {
  title: string;
  extractTitle: string;
  extractNote: string;
  partialScan: string;
  scope: string;
  server: string;
  version: string;
  scannedAt: string;
  catalog: string;
  overview: string;
  tileProcesses: string;
  tileWithBlocker: string;
  tileBlockerCauses: string;
  tileIntegration: string;
  tileAffected: string;
  tileUsage: string;
  controlProcesses: string;
  noReadinessVerdict: string;
  coverage: string;
  runLogWindow: string;
  runLogCapped: string;
  runLogMissing: string;
  gaps: string;
  notChecked: string;
  notCheckedItems: string[];
  /** Listed under "not checked" only when the scan did not read the rules. */
  notCheckedRules: string;
  causes: string;
  noFindings: string;
  ruleNames: Record<RuleId, string>;
  severity: string;
  processesCol: string;
  processCol: string;
  locationCol: string;
  detailCol: string;
  calledProcessesCol: string;
  severityBlocker: string;
  severityIntegration: string;
  severityConfig: string;
  evidenceIbm: string;
  evidenceMeasured: string;
  evidenceReported: string;
  replacement: string;
  processesN: string;
  processObject: string;
  affectedViaCall: string;
  affectedViaCallNote: string;
  dynamicCallers: string;
  dynamicCallersNote: string;
  usageNotEvidenced: string;
  usageNotEvidencedNote: string;
  manualChecks: string;
  manualChecksNote: string;
  manualCheckItems: string[];
  statusLabels: Record<string, string>;
  statusCol: string;
  /** Checkbox per cause: a known false alarm, kept out of nothing but marked as such. */
  falseAlarm: string;
  decisionCol: string;
  tileRetire: string;
  changesSince: string;
  changesNotComparable: string;
  newCauses: string;
  goneCauses: string;
  changedCounts: string;
  noChanges: string;
  rulesLabel: string;
  rulesChecked: string;
  objectCol: string;
  objectKinds: Record<ObjectKind, string>;
  tm1AppsTitle: string;
  compileDone: string;
  compilePartial: string;
  compileNotCheckable: string;
  compileNotRun: string;
  tm1AppsNote: string;
  /** Turns an ISO timestamp into the reader's date format; the identity when absent. */
  formatDate?: (iso: string) => string;
}

export type Cut = 'full' | 'extract';

export const fmt = (s: string, ...args: Array<string | number>): string =>
  s.replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));

const SECTION_LABEL: Record<string, string> = { prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog' };

/** The figures both cuts share. */
export function summarize(a: Analysis) {
  const blockerGroups = a.groups.filter(g => g.severity === 'blocker');
  return {
    userProcesses: a.processCount - a.controlProcessCount,
    processesWithBlocker: new Set(blockerGroups.flatMap(g => g.occurrences.filter(o => !o.rules && !o.object).map(o => o.process))).size,
    causesBlocker: blockerGroups.length,
    causesIntegration: a.groups.filter(g => g.severity === 'integration').length,
  };
}

function processCount(g: CauseGroup): number {
  return new Set(g.occurrences.map(o => (o.object ?? (o.rules ? 'cube' : 'proc')) + '|' + o.process)).size;
}

// ── neutral document model ──────────────────────────────────────────────────

type Control =
  | { control: 'status'; id: string; value: string; options: Array<{ value: string; label: string }> }
  | { control: 'flag'; id: string; checked: boolean; label: string };
type Inline = string | { open: Occurrence; text: string } | { link: string; text: string } | { badge: 'blocker' | 'integration' | 'muted' | 'ok'; text: string } | Control;
type Table = { head: string[]; rows: Inline[][][] };
type Block =
  | { h: 1 | 2; text: string }
  | { meta: Inline[][] }
  | { tiles: Array<{ value: number; label: string; tone?: 'blocker' }> }
  | { p: Inline[]; note?: boolean }
  | { ul: Inline[][] }
  | { table: Table }
  | { details: { summary: Inline[]; body: Block[]; open?: boolean; key?: string } };

function build(scan: ScanInput, a: Analysis, L: ReportL10n, cut: Cut, state: ReportState = { decisions: {} }): Block[] {
  const s = summarize(a);
  const date = (iso: string) => (typeof L.formatDate === 'function' ? L.formatDate(iso) : iso);
  const sevBadge = (g: CauseGroup): Inline => (g.severity === 'blocker' ? { badge: 'blocker', text: L.severityBlocker }
    : g.severity === 'integration' ? { badge: 'integration', text: L.severityIntegration } : { badge: 'muted', text: L.severityConfig });
  const out: Block[] = [];
  const dec = state.decisions;
  const opts = (list: readonly string[]) => list.map(v => ({ value: v, label: L.statusLabels[v] ?? v }));
  const statusBadge = (id: string): Inline[] => {
    const st = dec[id]?.status;
    if (!st || st === 'open' || st === 'unclear') { return []; }
    return [' ', { badge: st === 'not-an-issue' || st === 'keep' ? 'ok' : 'muted', text: L.statusLabels[st] ?? st }];
  };
  const causeLabel = (g: CauseGroup) => `${L.ruleNames[g.rule]}: ${g.rule === 'invalid-name' ? L.objectKinds[g.key as ObjectKind] ?? g.key : g.key}`;
  const groupLabel = (id: string) => {
    const g = a.groups.find(x => causeId(x) === id);
    return g ? causeLabel(g) : id;
  };

  out.push({ h: 1, text: cut === 'full' ? L.title : L.extractTitle });
  out.push({ meta: [
    [`${L.server}: ${scan.serverAlias}`],
    [`${L.version}: ${scan.productVersion ?? '?'}`],
    [fmt(L.controlProcesses, a.controlProcessCount)],
    [`${L.scannedAt}: ${date(scan.scannedAt)}`],
    [`${L.catalog}: ${date(CATALOG_AS_OF)} · `, { link: IBM_DEPRECATED_URL, text: 'IBM: Deprecated' }, ' · ', { link: IBM_CHANGED_URL, text: 'IBM: Changed' }],
  ] });
  if (!scan.complete) { out.push({ p: [L.partialScan], note: true }); }
  out.push({ p: [L.scope], note: true });
  if (cut === 'extract') { out.push({ p: [L.extractNote], note: true }); }

  // Part 1 — overview
  out.push({ h: 2, text: L.overview });
  out.push({ tiles: [
    { value: s.userProcesses, label: L.tileProcesses },
    { value: s.processesWithBlocker, label: L.tileWithBlocker, tone: 'blocker' },
    { value: s.causesBlocker, label: L.tileBlockerCauses, tone: 'blocker' },
    { value: s.causesIntegration, label: L.tileIntegration },
    { value: a.affectedViaCall.length, label: L.tileAffected },
    { value: a.usageNotEvidenced.length, label: L.tileUsage },
    ...(() => {
      const n = a.usageNotEvidenced.filter(r => dec[usageId(r.process)]?.status === 'retire').length;
      return n > 0 ? [{ value: n, label: L.tileRetire }] : [];
    })(),
  ] });
  if (a.groups.length > 0) {
    out.push({ table: {
      head: [L.causes, L.severity, L.processesCol],
      rows: a.groups.map(g => [[causeLabel(g), ...statusBadge(causeId(g))], [sevBadge(g)], [String(processCount(g))]]),
    } });
  }
  out.push({ p: [L.noReadinessVerdict], note: true });

  const tp = a.tm1Applications;
  if (tp.processes + tp.chores > 0) {
    out.push({ h: 2, text: L.tm1AppsTitle });
    out.push({ p: [fmt(L.tm1AppsNote, tp.processes, tp.chores, tp.withBlocker.length)] });
  }

  const c = state.comparison;
  if (c) {
    out.push({ h: 2, text: fmt(L.changesSince, date(c.since)) });
    if (!c.comparable) { out.push({ p: [L.changesNotComparable], note: true }); }
    const items: Inline[][] = [
      ...c.newCauses.map(id => [`${L.newCauses}: ${groupLabel(id)}`] as Inline[]),
      ...c.goneCauses.map(g => [`${L.goneCauses}: ${g.label} (${g.processes})`] as Inline[]),
      ...Object.entries(c.changedCount).map(([id, before]) => {
        const g = a.groups.find(x => causeId(x) === id);
        return [`${L.changedCounts}: ${groupLabel(id)} ${before} → ${g ? processCount(g) : '?'}`] as Inline[];
      }),
    ];
    out.push(items.length ? { ul: items } : { p: [L.noChanges] });
  }

  // Coverage — the gaps always, also in the extract
  out.push({ h: 2, text: L.coverage });
  const rl = scan.runLog;
  const cov: Inline[][] = [[
    rl ? fmt(L.runLogWindow, rl.from ? date(rl.from) : '—', rl.to ? date(rl.to) : '—', String(rl.lines).replace(/\B(?=(\d{3})+(?!\d))/g, ' '))
      + (rl.capped ? ' ' + L.runLogCapped : '') : L.runLogMissing,
  ]];
  if (scan.gaps.length > 0) { cov.push([`${L.gaps}: ${scan.gaps.join(', ')}`]); }
  const cs = a.compileSummary;
  cov.push([cs ? fmt(L.compileDone, cs.server, cs.version ?? '?', cs.checked, cs.rejected, cs.alsoStatic)
    + (cs.notCheckable ? ' ' + fmt(L.compileNotCheckable, cs.notCheckable) : '') + (cs.partial ? ' ' + L.compilePartial : '')
    : L.compileNotRun]);
  if (a.rulesCubeCount !== undefined) { cov.push([fmt(L.rulesChecked, a.rulesCubeCount)]); }
  cov.push([`${L.notChecked}: ${(a.rulesCubeCount !== undefined ? L.notCheckedItems : [L.notCheckedRules, ...L.notCheckedItems]).join(', ')}`]);
  out.push({ ul: cov });

  if (cut === 'full') {
    // Parts 3/4 — causes with occurrences
    out.push({ h: 2, text: L.causes });
    if (a.groups.length === 0) { out.push({ p: [L.noFindings] }); }
    for (const g of a.groups) {
      const ev: Inline = { badge: 'muted', text: g.evidence === 'ibm' ? L.evidenceIbm : g.evidence === 'measured' ? L.evidenceMeasured : L.evidenceReported };
      const id = causeId(g);
      const body: Block[] = [{ p: [{ control: 'flag', id, checked: dec[id]?.status === 'not-an-issue', label: L.falseAlarm }] }];
      if (g.replacement) { body.push({ p: [`${L.replacement}: ${g.replacement}`] }); }
      body.push({ table: {
        head: [g.occurrences.some(o => o.rules || o.object) ? L.objectCol : L.processCol, L.locationCol, L.detailCol],
        rows: g.occurrences.map(o => [
          [o.object ? o.process : { open: o, text: o.process }],
          [o.object ? L.objectKinds[o.object] : o.rules ? `${L.rulesLabel} ${(o.line ?? 0) + 1}` : o.section ? `${SECTION_LABEL[o.section]} ${(o.line ?? 0) + 1}` : L.processObject],
          [o.detail],
        ]),
      } });
      out.push({ details: {
        summary: [`${causeLabel(g)} `, sevBadge(g), ' ', ev, ` ${fmt(L.processesN, processCount(g))}`, ...statusBadge(causeId(g))],
        body,
        key: causeId(g),
      } });
    }

    out.push({ h: 2, text: `${L.affectedViaCall} (${a.affectedViaCall.length})` });
    out.push({ p: [L.affectedViaCallNote], note: true });
    if (a.affectedViaCall.length > 0) {
      out.push({ table: {
        head: [L.processCol, L.calledProcessesCol],
        rows: a.affectedViaCall.map(r => [[{ open: { process: r.process, detail: '' }, text: r.process }], [r.callees.join(', ')]]),
      } });
    }

    if (a.dynamicCallers.length > 0) {
      out.push({ h: 2, text: `${L.dynamicCallers} (${a.dynamicCallers.length})` });
      out.push({ p: [L.dynamicCallersNote], note: true });
      out.push({ ul: a.dynamicCallers.map(n => [{ open: { process: n, detail: '' }, text: n }]) });
    }

    out.push({ h: 2, text: `${L.usageNotEvidenced} (${a.usageNotEvidenced.length})` });
    out.push({ p: [L.usageNotEvidencedNote], note: true });
    if (a.usageNotEvidenced.length > 0) {
      // Long on real servers (163 of 267 on the 11.8 test server) — folded by default.
      out.push({ details: {
        key: 'usage',
        summary: [fmt(L.processesN, a.usageNotEvidenced.length)],
        body: [{ table: {
          head: [L.processCol, L.decisionCol],
          rows: a.usageNotEvidenced.map(r => {
            const id = usageId(r.process);
            return [
              [{ open: { process: r.process, detail: '' }, text: r.process }],
              [{ control: 'status', id, value: dec[id]?.status ?? 'unclear', options: opts(USAGE_STATUSES) }],
            ];
          }),
        } }],
      } });
    }
  }

  // Part 5 — manual checks (static list; tracking them belongs in the project's own tools)
  out.push({ h: 2, text: L.manualChecks });
  out.push({ p: [L.manualChecksNote], note: true });
  out.push({ ul: L.manualCheckItems.map(i => [i]) });
  return out;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inlineHtml(parts: Inline[], interactive: boolean): string {
  return parts.map(x => {
    if (typeof x === 'string') { return escHtml(x); }
    if ('link' in x) { return `<a href="${escHtml(x.link)}">${escHtml(x.text)}</a>`; }
    if ('badge' in x) { return `<span class="badge ${x.badge}">${escHtml(x.text)}</span>`; }
    if ('control' in x) {
      if (x.control === 'flag') {
        if (!interactive) { return x.checked ? escHtml(x.label) : ''; }
        return `<label class="flag"><input type="checkbox" data-decide="flag" data-id="${escHtml(x.id)}"${x.checked ? ' checked' : ''}> ${escHtml(x.label)}</label>`;
      }
      if (!interactive) { return escHtml(x.options.find(o => o.value === x.value)?.label ?? x.value); }
      return `<select data-decide="status" data-id="${escHtml(x.id)}">${x.options.map(o =>
        `<option value="${escHtml(o.value)}"${o.value === x.value ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('')}</select>`;
    }
    if (!interactive) { return escHtml(x.text); }
    const o = x.open;
    if (o.rules) { return `<a href="#" data-cube="${escHtml(o.process)}" data-line="${o.line ?? 0}">${escHtml(x.text)}</a>`; }
    return `<a href="#" data-process="${escHtml(o.process)}" data-section="${escHtml(o.section ?? '')}" data-line="${o.line ?? 0}">${escHtml(x.text)}</a>`;
  }).join('');
}

function tableHtml(t: Table, interactive: boolean): string {
  const head = `<thead><tr>${t.head.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`;
  const rows = t.rows.map(r => `<tr>${r.map(c => `<td>${inlineHtml(c, interactive)}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${rows}</tbody></table>`;
}

function blocksHtml(blocks: Block[], interactive: boolean, toolbar: string): string {
  return blocks.map(b => {
    if ('h' in b) {
      return b.h === 1
        ? `<div class="head"><span class="title">${escHtml(b.text)}</span><span class="spacer"></span>${toolbar}</div>`
        : `<h2>${escHtml(b.text)}</h2>`;
    }
    if ('meta' in b) { return `<div class="meta">${b.meta.map(m => `<span>${inlineHtml(m, interactive)}</span>`).join('')}</div>`; }
    if ('tiles' in b) {
      return `<div class="tiles">${b.tiles.map(t =>
        `<div class="tile${t.tone ? ' ' + t.tone : ''}"><span class="v">${t.value}</span><span class="l">${escHtml(t.label)}</span></div>`).join('')}</div>`;
    }
    if ('p' in b) { return `<p${b.note ? ' class="note"' : ''}>${inlineHtml(b.p, interactive)}</p>`; }
    if ('ul' in b) { return b.ul.length ? `<ul>${b.ul.map(li => `<li>${inlineHtml(li, interactive)}</li>`).join('')}</ul>` : ''; }
    if ('table' in b) { return tableHtml(b.table, interactive); }
    const key = b.details.key ? ` data-key="${escHtml(b.details.key)}"` : '';
    return `<details${key}${b.details.open ? ' open' : ''}><summary>${inlineHtml(b.details.summary, interactive)}</summary>`
      + blocksHtml(b.details.body, interactive, '') + '</details>';
  }).join('\n');
}

/**
 * Body fragment. `interactive` adds the jump links the panel wires up; `toolbar` is
 * markup placed at the right end of the title bar (the panel's export buttons).
 */
export function toHtmlBody(scan: ScanInput, a: Analysis, L: ReportL10n, cut: Cut, interactive: boolean, toolbar = '', state?: ReportState): string {
  return `<div class="report">${blocksHtml(build(scan, a, L, cut, state), interactive, toolbar)}</div>`;
}

/**
 * Follows the object overview pages (`objectOverview/overviewShell.ts`): theme variables,
 * 12-13 px, tiles, sticky table head. Every variable has a fallback so the exported file
 * looks the same outside VS Code.
 */
export const REPORT_CSS = `
body{margin:0;padding:0;font-family:var(--vscode-font-family,system-ui,-apple-system,Segoe UI,sans-serif);font-size:13px;color:var(--vscode-foreground,#1f1f1f);background:var(--vscode-editor-background,#fff);}
.report{max-width:1100px;padding:0 16px 24px;}
.head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--vscode-panel-border,#ddd);background:var(--vscode-editor-background,#fff);}
.title{font-size:14px;font-weight:600;}
.spacer{flex:1;}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;padding:8px 0 2px;font-size:12px;color:var(--vscode-descriptionForeground,#666);}
h2{font-size:13px;font-weight:600;margin:22px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--vscode-panel-border,#ddd);}
.note{margin:6px 0;font-size:12px;color:var(--vscode-descriptionForeground,#666);}
.tiles{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px;}
.tile{display:inline-flex;align-items:baseline;gap:6px;background:var(--vscode-editorWidget-background,#f6f6f6);border:1px solid var(--vscode-panel-border,#ddd);border-radius:6px;padding:3px 10px;}
.tile .v{font-size:14px;font-weight:700;}
.tile.blocker .v{color:var(--vscode-errorForeground,#c42b1c);}
.tile .l{font-size:11px;color:var(--vscode-descriptionForeground,#666);text-transform:uppercase;letter-spacing:.04em;}
table{border-collapse:collapse;width:100%;font-size:12px;margin:4px 0 8px;}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--vscode-panel-border,#ddd);vertical-align:top;}
th{position:sticky;top:44px;background:var(--vscode-sideBar-background,#f3f3f3);font-weight:600;}
tbody tr:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.08));}
td:nth-child(3){word-break:break-all;}
details{border-bottom:1px solid var(--vscode-panel-border,#ddd);}
details>table{margin:0 0 10px 18px;width:calc(100% - 18px);}
details>p{margin:6px 0 6px 18px;font-size:12px;}
details>ul{margin:0 0 10px 18px;}
summary{cursor:pointer;padding:6px 0;font-size:12px;}
summary:hover{background:var(--vscode-list-hoverBackground,rgba(128,128,128,.08));}
.badge{display:inline-block;padding:0 6px;margin-left:4px;font-size:10px;border-radius:3px;background:var(--vscode-badge-background,#ddd);color:var(--vscode-badge-foreground,#333);}
.badge.blocker{background:var(--vscode-inputValidation-errorBackground,#f8d7da);color:var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));border:1px solid var(--vscode-inputValidation-errorBorder,#c42b1c);}
.badge.integration{background:var(--vscode-inputValidation-infoBackground,#d6ebff);color:var(--vscode-foreground,#1f1f1f);}
.badge.ok{background:transparent;border:1px solid var(--vscode-charts-green,#388a34);color:var(--vscode-charts-green,#388a34);}
label.flag{font-size:12px;cursor:pointer;}
select{font:inherit;font-size:12px;padding:1px 4px;color:var(--vscode-input-foreground,#1f1f1f);background:var(--vscode-input-background,#fff);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#ccc));border-radius:2px;}
.badge.muted{background:transparent;border:1px solid var(--vscode-panel-border,#ddd);color:var(--vscode-descriptionForeground,#666);}
ul{margin:4px 0 8px;padding-left:20px;font-size:12px;}
li{margin:2px 0;}
a{color:var(--vscode-textLink-foreground,#0066b8);text-decoration:none;}
a:hover{text-decoration:underline;}
`;

/** Standalone file for the export: no script, no external resource. */
export function toHtmlDocument(scan: ScanInput, a: Analysis, L: ReportL10n, cut: Cut, state?: ReportState): string {
  const title = cut === 'full' ? L.title : L.extractTitle;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escHtml(title)}</title><style>${REPORT_CSS}</style></head><body>\n`
    + toHtmlBody(scan, a, L, cut, false, '', state) + '\n</body></html>\n';
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export const escMd = (s: string): string => s.replace(/([\\`*_[\]<>|#])/g, '\\$1');

function inlineMd(parts: Inline[]): string {
  return parts.map(x => {
    if (typeof x === 'string') { return escMd(x); }
    if ('link' in x) { return `[${escMd(x.text)}](${x.link})`; }
    if ('badge' in x) { return `**${escMd(x.text)}**`; }
    if ('control' in x) {
      if (x.control === 'flag') { return x.checked ? escMd(x.label) : ''; }
      return escMd(x.options.find(o => o.value === x.value)?.label ?? x.value);
    }
    return escMd(x.text);
  }).join('');
}

function tableMd(t: Table): string {
  const head = `| ${t.head.map(escMd).join(' | ')} |\n|${t.head.map(() => ' --- ').join('|')}|`;
  return head + '\n' + t.rows.map(r => `| ${r.map(inlineMd).join(' | ')} |`).join('\n') + '\n';
}

function blocksMd(blocks: Block[]): string[] {
  return blocks.flatMap(b => {
    if ('h' in b) { return [`${'#'.repeat(b.h)} ${escMd(b.text)}\n`]; }
    if ('meta' in b) { return [b.meta.map(m => `- ${inlineMd(m)}`).join('\n') + '\n']; }
    if ('tiles' in b) { return [b.tiles.map(t => `- **${t.value}** ${escMd(t.label)}`).join('\n') + '\n']; }
    if ('p' in b) { return [(b.note ? `_${inlineMd(b.p)}_` : inlineMd(b.p)) + '\n']; }
    if ('ul' in b) { return b.ul.length ? [b.ul.map(li => `- ${inlineMd(li)}`).join('\n') + '\n'] : []; }
    if ('table' in b) { return [tableMd(b.table)]; }
    return [`### ${inlineMd(b.details.summary)}\n`, ...blocksMd(b.details.body)];
  });
}

export function toMarkdown(scan: ScanInput, a: Analysis, L: ReportL10n, cut: Cut, state?: ReportState): string {
  return blocksMd(build(scan, a, L, cut, state)).join('\n');
}
