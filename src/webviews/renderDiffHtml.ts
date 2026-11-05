/**
 * Pure HTML renderer for the per-test Diff-Webview. Takes a manifest +
 * DiffResult + DiffSummary and produces a self-contained HTML document
 * styled via VS Code theme variables. The webview manager only wraps this
 * with a WebviewPanel + CSP nonce.
 */

import * as vscode from 'vscode';
import { isRootManifest } from '../tiTestFramework/storage/manifestIo';
import type { Manifest } from '../tiTestFramework/storage/manifestIo';
import { diffCount, type DiffResult, type DiffSummary } from '../tiTestFramework/diff/diffResult';
import type { CellDiffEntry, HiddenCounts } from '../tiTestFramework/diff/cellDiff';
import { escapeHtml } from '../utils/escapeHtml';

export type DiffViewInput = {
  manifest: Manifest;
  diff: DiffResult;
  summary: DiffSummary;
  cspNonce?: string;
  cubeDims?: Record<string, string[]>;
  /** Webview URI of out/webview/tiTestDiff.js; omitted in unit tests. */
  scriptUri?: string;
};

const fmtValue = (v: number | string | undefined): string => {
  if (v === undefined) return '<span class="muted">∅</span>';
  if (typeof v === 'number') return String(v);
  return `"${escapeHtml(v)}"`;
};

type CellGroup = {
  equal: CellDiffEntry[];
  valueDiff: CellDiffEntry[];
  missing: CellDiffEntry[];
  extra: CellDiffEntry[];
};

function groupByCube(diff: DiffResult['cell']): Map<string, CellGroup> {
  const out = new Map<string, CellGroup>();
  const ensure = (cube: string): CellGroup => {
    let g = out.get(cube);
    if (!g) {
      g = { equal: [], valueDiff: [], missing: [], extra: [] };
      out.set(cube, g);
    }
    return g;
  };
  for (const e of diff.valueDiff) ensure(e.cube).valueDiff.push(e);
  for (const e of diff.missing) ensure(e.cube).missing.push(e);
  for (const e of diff.extra) ensure(e.cube).extra.push(e);
  for (const e of diff.equal) ensure(e.cube).equal.push(e);
  return out;
}

function renderCubeRow(
  entry: CellDiffEntry,
  kind: 'equal' | 'valueDiff' | 'missing' | 'extra',
  coordCount: number,
): string {
  const tds: string[] = [];
  for (let i = 0; i < coordCount; i++) {
    tds.push(`<td class="coord">${escapeHtml(entry.coord[i] ?? '')}</td>`);
  }
  tds.push(`<td class="value">${fmtValue(entry.expected)}</td>`);
  tds.push(`<td class="value">${fmtValue(entry.actual)}</td>`);
  return `<tr class="row-${kind}">${tds.join('')}</tr>`;
}

/** Entries in display order (diffs before equal rows), each tagged with its kind. */
function tagRows<E, K extends string>(lists: [K, E[]][]): [K, E][] {
  const rows: [K, E][] = [];
  for (const [kind, list] of lists) for (const e of list) rows.push([kind, e]);
  return rows;
}

/** Rows `capDiffResult` dropped — the diff arrives capped (`tm1.tests.maxDiffRows`), the page renders what is left. */
function hiddenNote(hidden: HiddenCounts | undefined): string {
  const n = hidden ? hidden.equal + hidden.valueDiff + hidden.missing + hidden.extra : 0;
  return n > 0
    ? `<p class="muted">${escapeHtml(vscode.l10n.t('{0} more rows not shown. Raise tm1.tests.maxDiffRows to keep more.', n))}</p>`
    : '';
}

function renderCubeTable(
  cube: string,
  group: CellGroup,
  cubeDims?: string[],
): string {
  const total = group.valueDiff.length + group.missing.length + group.extra.length;
  const rows = tagRows<CellDiffEntry, 'equal' | 'valueDiff' | 'missing' | 'extra'>([
    ['valueDiff', group.valueDiff], ['missing', group.missing], ['extra', group.extra], ['equal', group.equal],
  ]);
  const maxCoords = rows.reduce((m, [, e]) => Math.max(m, e.coord.length), 0);
  const headers: string[] = [];
  for (let i = 0; i < maxCoords; i++) {
    headers.push(cubeDims?.[i] ?? vscode.l10n.t('Dim {0}', i + 1));
  }
  return `
    <section class="section" data-kind="cube">
      <h2>${escapeHtml(cube)} <span class="badge">${escapeHtml(vscode.l10n.t('{0} diffs', total))}</span></h2>
      <table>
        <thead>
          <tr>
            ${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}
            <th>${escapeHtml(vscode.l10n.t('Expected'))}</th>
            <th>${escapeHtml(vscode.l10n.t('Actual'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([kind, e]) => renderCubeRow(e, kind, maxCoords)).join('')}
        </tbody>
      </table>
    </section>
  `;
}

function renderCellSection(diff: DiffResult['cell'], cubeDims?: Record<string, string[]>): string {
  const groups = groupByCube(diff);
  const note = hiddenNote(diff.hidden);
  if (groups.size === 0) {
    return `<section class="section"><h2>${escapeHtml(vscode.l10n.t('Cells'))}</h2>${note || `<p class="muted">${escapeHtml(vscode.l10n.t('No cell writes recorded.'))}</p>`}</section>`;
  }
  const sortedCubes = [...groups.keys()].sort();
  // Per-cube badges count the kept rows; the note carries what the cap dropped.
  return (note ? `<section class="section">${note}</section>` : '') + sortedCubes
    .map((cube) => renderCubeTable(cube, groups.get(cube)!, cubeDims?.[cube]))
    .join('');
}

/**
 * Format a typed op row as `op  field1=value1  field2=value2 …`. Field-order
 * picked per op so the most identifying columns come first. Empty values
 * shown as `''` so set-vs-missing is visible.
 */
function formatOpRow(row: Record<string, unknown> | undefined): string {
  if (!row) return '∅';
  const op = String(row.op ?? '');
  const order = OP_FIELD_ORDER[op] ?? Object.keys(row).filter((k) => k !== 'op');
  const parts = order
    .filter((k) => k in row)
    .map((k) => {
      const v = row[k];
      const txt =
        v === undefined
          ? ''
          : Array.isArray(v)
            ? v.map(String).join(',')
            : String(v);
      return `${k}=${txt === '' ? "''" : txt}`;
    });
  return [op, ...parts].join('  ');
}

const OP_FIELD_ORDER: Record<string, string[]> = {
  AttrPutS: ['dim', 'hier', 'element', 'attribute', 'value'],
  AttrPutN: ['dim', 'hier', 'element', 'attribute', 'value'],
  AttrInsert: ['dim', 'attribute', 'type', 'prevAttr'],
  AttrDelete: ['dim', 'attribute'],
  CubeAttrInsert: ['attribute', 'type', 'prevAttr'],
  CubeAttrDelete: ['attribute'],
  DimensionAttrInsert: ['attribute', 'type', 'prevAttr'],
  DimensionAttrDelete: ['attribute'],
  ChoreAttrInsert: ['attribute', 'type', 'prevAttr'],
  ChoreAttrDelete: ['attribute'],
  ViewAttrInsert: ['attribute', 'type', 'prevAttr'],
  ViewAttrDelete: ['attribute'],
  SubsetAttrInsert: ['attribute', 'type', 'prevAttr'],
  SubsetAttrDelete: ['attribute'],
  HierarchySubsetAttrInsert: ['dim', 'hier', 'subset', 'attribute', 'type'],
  HierarchySubsetAttrDelete: ['dim', 'hier', 'subset', 'attribute'],
  DimElementInsert: ['dim', 'hier', 'name', 'type', 'insertAfter'],
  DimElementDelete: ['dim', 'hier', 'name'],
  DimElementComponentAdd: ['dim', 'hier', 'parent', 'child', 'weight'],
  DimElementComponentDelete: ['dim', 'hier', 'parent', 'child'],
  DimensionCreate: ['name'],
  DimensionDestroy: ['name'],
  HierarchyCreate: ['dim', 'hier'],
  HierarchyDestroy: ['dim', 'hier'],
  HierarchyElementSecurityPut: ['dim', 'hier', 'element', 'group', 'level'],
  SubsetCreate: ['dim', 'hier', 'subset'],
  SubsetCreateByMDX: ['dim', 'hier', 'subset', 'mdx'],
  SubsetElementInsert: ['dim', 'hier', 'subset', 'element', 'position'],
  SubsetElementDelete: ['dim', 'hier', 'subset', 'element'],
  SubsetDeleteAllElements: ['dim', 'hier', 'subset'],
  SubsetDestroy: ['dim', 'hier', 'subset'],
  SubsetMDXSet: ['dim', 'hier', 'subset', 'mdx'],
  SubsetIsAllSet: ['dim', 'hier', 'subset', 'flag'],
  SubsetAliasSet: ['dim', 'hier', 'subset', 'alias'],
  ViewCreate: ['cube', 'view'],
  ViewZeroOut: ['cube', 'view'],
  ViewDelete: ['cube', 'view'],
  ViewDestroy: ['cube', 'view'],
  ViewMDXSet: ['cube', 'view', 'mdx'],
  ViewSuppressZeroesSet: ['cube', 'view', 'flag'],
  ViewZeroSuppressionSet: ['cube', 'view', 'flag'],
  ViewRowDimensionSet: ['cube', 'view', 'dim', 'position'],
  ViewColumnDimensionSet: ['cube', 'view', 'dim', 'position'],
  ViewTitleDimensionSet: ['cube', 'view', 'dim', 'position'],
  ViewTitleElementSet: ['cube', 'view', 'dim', 'element'],
  ViewExtractSkipCalcsSet: ['cube', 'view', 'skip'],
  ViewExtractSkipConsolidatedValuesSet: ['cube', 'view', 'skip'],
  ViewExtractSkipRuleValuesSet: ['cube', 'view', 'skip'],
  ViewExtractSkipZeroesSet: ['cube', 'view', 'skip'],
  ViewExtractSkipConsolidatedStringsSet: ['cube', 'view', 'skip'],
  ViewSubsetAssign: ['cube', 'view', 'dim', 'subset'],
  ViewStructUpdate: ['cube', 'view'],
  CubeCreate: ['name', 'dimensions'],
  CubeDestroy: ['name'],
  CubeDelete: ['name'],
  CubeRuleDestroy: ['name'],
  RuleDestroy: ['name'],
  CellSecurityCubeCreate: ['name'],
  CellSecurityCubeDestroy: ['name'],
  CubeDataReservationRelease: ['name', 'elements'],
  CubeDRRelease: ['name', 'elementList'],
  TranSave: ['transactionId'],
  TranDelete: ['transactionId'],
};

function renderOpListSection<T>(
  kind: string,
  title: string,
  diff: {
    equal: { key: string; expected?: T; actual?: T }[];
    valueDiff: { key: string; expected?: T; actual?: T }[];
    missing: { key: string; expected?: T; actual?: T }[];
    extra: { key: string; expected?: T; actual?: T }[];
    hidden?: HiddenCounts;
  },
): string {
  const total = diffCount(diff, 'valueDiff') + diffCount(diff, 'missing') + diffCount(diff, 'extra');
  if (total === 0 && diffCount(diff, 'equal') === 0) return '';
  const fmt = (e: { expected?: T; actual?: T }) =>
    formatOpRow((e.expected ?? e.actual) as Record<string, unknown> | undefined);
  const tag = { valueDiff: '≠', missing: '−', extra: '+', equal: '=' } as const;
  const rows = tagRows<{ expected?: T; actual?: T }, keyof typeof tag>([
    ['valueDiff', diff.valueDiff], ['missing', diff.missing], ['extra', diff.extra], ['equal', diff.equal],
  ]);
  return `
    <section class="section" data-kind="${kind}">
      <h2>${escapeHtml(title)} <span class="badge">${escapeHtml(vscode.l10n.t('{0} diffs', total))}</span></h2>
      <ul class="op-list">
        ${rows
          .map(([k, e]) => `<li class="row-${k}"><span class="op-tag">${tag[k]}</span> ${escapeHtml(fmt(e))}</li>`)
          .join('')}
      </ul>
      ${hiddenNote(diff.hidden)}
    </section>
  `;
}

function renderStatusSection(status: DiffResult['status']): string {
  if (status.equal) {
    return `<section class="section"><h2>${escapeHtml(vscode.l10n.t('Status'))}</h2><p class="muted">${escapeHtml(vscode.l10n.t('match ({0})', status.expected.status))}</p></section>`;
  }
  return `
    <section class="section" data-kind="status">
      <h2>${escapeHtml(vscode.l10n.t('Status'))} <span class="badge fail">${escapeHtml(vscode.l10n.t('mismatch'))}</span></h2>
      <table>
        <thead><tr><th></th><th>${escapeHtml(vscode.l10n.t('Expected'))}</th><th>${escapeHtml(vscode.l10n.t('Actual'))}</th></tr></thead>
        <tbody>
          <tr><td>${escapeHtml(vscode.l10n.t('status'))}</td><td>${escapeHtml(status.expected.status)}</td><td>${escapeHtml(status.actual.status)}</td></tr>
          <tr><td>${escapeHtml(vscode.l10n.t('error log'))}</td><td><pre>${escapeHtml(status.expected.errorLogContent || '∅')}</pre></td><td><pre>${escapeHtml(status.actual.errorLogContent || '∅')}</pre></td></tr>
        </tbody>
      </table>
    </section>
  `;
}

const STYLES = `
  :root {
    color-scheme: var(--vscode-color-scheme);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  body { margin: 0; padding: 12px 16px; }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  header h1 { margin: 0; font-size: 1.1rem; }
  .pill { padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; }
  .pill.pass { background: var(--vscode-testing-iconPassed, #2da44e); color: #fff; }
  .pill.fail { background: var(--vscode-testing-iconFailed, #cf222e); color: #fff; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
  .section { margin: 18px 0; padding: 8px 0; border-top: 1px solid var(--vscode-panel-border); }
  .section h2 { font-size: 1rem; margin: 0 0 8px 0; }
  .badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 8px; border-radius: 8px; font-size: 0.75rem; font-weight: normal; margin-left: 8px; }
  .badge.fail { background: var(--vscode-testing-iconFailed, #cf222e); color: #fff; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  th { font-weight: 600; color: var(--vscode-descriptionForeground); }
  td.coord { font-family: var(--vscode-editor-font-family); font-size: 0.9rem; }
  td.value { font-family: var(--vscode-editor-font-family); font-size: 0.9rem; }
  pre { margin: 0; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; }
  .muted { color: var(--vscode-descriptionForeground); }
  .row-valueDiff { background: var(--vscode-inputValidation-errorBackground, rgba(207, 34, 46, 0.12)); }
  .row-missing   { background: var(--vscode-inputValidation-errorBackground, rgba(207, 34, 46, 0.12)); border-left: 3px solid var(--vscode-inputValidation-errorBorder, rgba(207, 34, 46, 0.6)); }
  .row-extra     { background: var(--vscode-inputValidation-warningBackground, rgba(255, 140, 0, 0.14)); border-left: 3px solid var(--vscode-inputValidation-warningBorder, rgba(255, 140, 0, 0.7)); }
  .row-equal     { color: var(--vscode-descriptionForeground); }
  .row-equal td.value { opacity: 0.7; }
  td.coord:first-child { padding-left: 6px; }
  .op-list { list-style: none; padding: 0; margin: 0; font-family: var(--vscode-editor-font-family); font-size: 0.9rem; }
  .op-list li { padding: 3px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  .op-tag { display: inline-block; width: 1.2em; text-align: center; font-weight: 600; margin-right: 6px; }
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
  .toolbar button { padding: 4px 10px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font-size: 0.85rem; }
  .toolbar button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background))); }
  .toolbar button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  body[data-filter="diffs"] .row-equal { display: none; }
`;

export function renderDiffHtml(input: DiffViewInput): string {
  const { manifest, diff, summary, cspNonce, cubeDims, scriptUri } = input;
  const rootManifest = isRootManifest(manifest) ? manifest : undefined;
  const manifestProcess = rootManifest?.process ?? '';
  const manifestCapturedAt = rootManifest?.captured?.at ?? '';
  const manifestCapturedServer = rootManifest?.captured?.server ?? '';
  const passClass = summary.pass ? 'pass' : 'fail';
  const passLabel = summary.pass ? vscode.l10n.t('PASS') : vscode.l10n.t('FAIL');
  const nonceAttr = cspNonce ? ` nonce="${escapeHtml(cspNonce)}"` : '';
  // CSP is always emitted. With a nonce, scripts run under it; without one
  // (misconfigured caller) scripts are locked out ('none') rather than leaving
  // the page with no policy at all — this view renders TM1 data via innerHTML.
  const scriptSrc = cspNonce ? `'nonce-${escapeHtml(cspNonce)}'` : `'none'`;
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptSrc};">`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${cspMeta}
  <title>${escapeHtml(vscode.l10n.t('{0} — Diff', manifest.name))}</title>
  <style>${STYLES}</style>
</head>
<body data-filter="all">
  <header>
    <div>
      <h1>${escapeHtml(manifest.name)} <span class="pill ${passClass}">${escapeHtml(passLabel)}</span></h1>
      <div class="meta">
        ${escapeHtml(vscode.l10n.t('process: {0} · captured: {1} · server: {2}', manifestProcess, manifestCapturedAt, manifestCapturedServer))}
      </div>
    </div>
    <div class="meta">
      ${escapeHtml(vscode.l10n.t('{0} total diffs (cell {1} · dim {2} · attr {3} · subset {4} · view {5} · cube {6} · tran {7} · meta {8} · status {9})', summary.totalDiffs, summary.cellDiffs, summary.dimDiffs, summary.attrDiffs, summary.subsetDiffs, summary.viewDiffs, summary.cubeDiffs, summary.tranDiffs, summary.metaDiffs, summary.statusDiff ? vscode.l10n.t('diff') : '✓'))}
    </div>
  </header>
  <div class="toolbar">
    <button data-filter="all" class="active">${escapeHtml(vscode.l10n.t('All'))}</button>
    <button data-filter="diffs">${escapeHtml(vscode.l10n.t('Diffs only'))}</button>
  </div>
  ${renderCellSection(diff.cell, cubeDims)}
  ${renderOpListSection('dimensions', vscode.l10n.t('Dimensions'), diff.dim)}
  ${renderOpListSection('attributes', vscode.l10n.t('Attributes'), diff.attr)}
  ${renderOpListSection('subsets', vscode.l10n.t('Subsets'), diff.subset)}
  ${renderOpListSection('views', vscode.l10n.t('Views'), diff.view)}
  ${renderOpListSection('cubes', vscode.l10n.t('Cubes'), diff.cube)}
  ${renderOpListSection('transactions', vscode.l10n.t('Transactions'), diff.tran)}
  ${renderOpListSection('meta', vscode.l10n.t('Meta'), diff.meta)}
  ${renderStatusSection(diff.status)}
  ${scriptUri ? `<script${nonceAttr} src="${escapeHtml(scriptUri)}"></script>` : ''}
</body>
</html>`;
}
