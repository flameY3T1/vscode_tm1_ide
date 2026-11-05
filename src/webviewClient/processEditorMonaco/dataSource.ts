import {
  normalizeReadDataSource as _pureNormalize,
  cleanDataSource as _pureClean,
  escapeAttr as _pureEscapeAttr,
  parseOdbcSelectColumns,
  odbcPasswordRow,
  type DsHost,
  type DataSource,
  type DataSourceType,
} from './dataSourcePure';
import { getL10n, fmt } from '../_shared/l10n';
import { mountTitleCombo, closeTitleCombo } from '../_shared/filterCombo';

const L = getL10n();

export type { DataSource };

const TYPES: DataSourceType[] = ['None', 'ASCII', 'ODBC', 'TM1CubeView', 'TM1DimensionSubset'];

let current: DataSource = { Type: 'None' };
let onChangeCb: (() => void) | null = null;

/** Which editor embeds this form; the template editor cannot keep a password. */
let host: DsHost = 'process';

export function setDsHost(h: DsHost): void { host = h; }

interface ServerBridge {
  fetchCubes: () => void;
  fetchViews: (cubeName: string) => void;
  fetchDimensions: () => void;
  fetchSubsets: (dimensionName: string) => void;
  fetchCubeDimensions: (cubeName: string) => void;
  fetchOdbcDsns: () => void;
  fetchAsciiPreview: (args: { filePath: string; delimiter: string; quoteChar: string; headerRecords: number; maxLines: number }) => void;
  fetchOdbcPreview: (args: { dataSource: DataSource; variableNames: string[]; maxRows: number }) => void;
  applyVariables: (variables: Array<{ Name: string; Type: 'Numeric' | 'String'; Position: number }>) => void;
}
let bridge: ServerBridge | null = null;

/**
 * Declared variable names in position order, injected by the host module. Read
 * lazily through a callback rather than importing `variables.ts`, which imports
 * this module back.
 */
let getVariableNames: () => string[] = () => [];

export function setVariableNameSource(fn: () => string[]): void {
  getVariableNames = fn;
}

interface PreviewState {
  rows: string[][];
  headerRecords: number;
  truncated?: boolean;
  error?: string;
  source?: 'client' | 'server';
  /**
   * Column headers supplied by the host. ASCII leaves this unset and uses the
   * file's own first row; ODBC has no header row anywhere on its path, so the
   * host derives one from the declared variable names.
   */
  header?: string[];
  /** Element the table is drawn into — each datasource type has its own box. */
  boxId: string;
}

let asciiPreviewState: PreviewState | null = null;

const cache = {
  cubes: null as string[] | null,
  viewsByCube: {} as Record<string, string[]>,
  dimensions: null as string[] | null,
  subsetsByDim: {} as Record<string, string[]>,
  odbcDsns: null as string[] | null,
};

export function setServerBridge(b: ServerBridge): void {
  bridge = b;
}

export function receiveCubes(cubes: string[]): void {
  cache.cubes = cubes;
  if (current.Type === 'TM1CubeView') { rerender(); }
}

export function receiveViews(cubeName: string, views: string[]): void {
  cache.viewsByCube[cubeName] = views;
  if (current.Type === 'TM1CubeView' && current.dataSourceNameForServer === cubeName) {
    rerender();
  }
}

export function receiveDimensions(dims: string[]): void {
  cache.dimensions = dims;
  if (current.Type === 'TM1DimensionSubset') { rerender(); }
}

export function receiveSubsets(dimensionName: string, subsets: string[]): void {
  cache.subsetsByDim[dimensionName] = subsets;
  if (current.Type === 'TM1DimensionSubset' && current.dataSourceNameForServer === dimensionName) {
    rerender();
  }
}

export function receiveOdbcDsns(items: string[]): void {
  cache.odbcDsns = items;
  if (current.Type === 'ODBC') { rerender(); }
}

export function receiveCubeDimensions(cubeName: string, dimensions: string[]): void {
  if (!bridge) { return; }
  // Generate variables: v<DimName> (String) + vValue (Numeric)
  const variables: Array<{ Name: string; Type: 'Numeric' | 'String'; Position: number }> = dimensions.map((dim, idx) => ({
    Name: 'v' + dim, Type: 'String', Position: idx + 1,
  }));
  variables.push({ Name: 'vValue', Type: 'Numeric', Position: dimensions.length + 1 });
  bridge.applyVariables(variables);
  flashButton('btn-ds-cube-vars', fmt(L, 'dsVarsSet', dimensions.length + 1));
}

export function receiveAsciiPreview(payload: { rows?: string[][]; headerRecords?: number; truncated?: boolean; error?: string; source?: 'client' | 'server' }): void {
  asciiPreviewState = {
    rows: payload.rows ?? [],
    headerRecords: payload.headerRecords ?? 0,
    truncated: payload.truncated,
    error: payload.error,
    source: payload.source,
    boxId: 'ds-ascii-preview-box',
  };
  renderAsciiPreviewBox();
}

export function receiveOdbcPreview(payload: { rows?: string[][]; header?: string[]; truncated?: boolean; error?: string }): void {
  asciiPreviewState = {
    rows: payload.rows ?? [],
    headerRecords: 0,
    truncated: payload.truncated,
    error: payload.error,
    header: payload.header ?? [],
    boxId: 'ds-odbc-preview-box',
  };
  renderAsciiPreviewBox();
}

function renderAsciiPreviewBox(loadingText?: string): void {
  const box = document.getElementById(asciiPreviewState?.boxId ?? 'ds-ascii-preview-box');
  if (!box) { return; }
  if (loadingText && !asciiPreviewState?.error && (!asciiPreviewState?.rows || asciiPreviewState.rows.length === 0)) {
    box.innerHTML = `<div style="margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 11px;">${loadingText}</div>`;
    return;
  }
  if (!asciiPreviewState) { box.innerHTML = ''; return; }
  if (asciiPreviewState.error) {
    box.innerHTML = `<div style="margin-top: 8px; color: var(--vscode-errorForeground); font-size: 12px;">${escapeAttr(asciiPreviewState.error)}</div>`;
    return;
  }
  const rows = asciiPreviewState.rows;
  if (rows.length === 0) {
    box.innerHTML = `<div style="margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 11px;">${L.dsFileEmpty}</div>`;
    return;
  }
  // ASCII shows the file's first record as the header row; ODBC gets its headers
  // from the host, so every returned row is data.
  const hostHeader = asciiPreviewState.header;
  const header = hostHeader ?? rows[0];
  const dataRows = hostHeader ? rows : rows.slice(1);
  const colCount = Math.max(header.length, ...rows.map(r => r.length));

  const parts: string[] = [];
  parts.push('<div style="margin-top: 8px; overflow: auto; max-height: 60vh; border: 1px solid var(--vscode-panel-border); border-radius: 2px;">');
  parts.push('<table class="params-table" style="font-family: var(--vscode-editor-font-family); white-space: nowrap; min-width: 100%;"><thead><tr>');
  parts.push('<th style="width: 48px; text-align: right; color: var(--vscode-descriptionForeground); position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 1;">#</th>');
  for (let i = 0; i < colCount; i++) {
    parts.push(`<th style="position: sticky; top: 0; background: var(--vscode-sideBar-background); z-index: 1;">${escapeAttr(header[i] ?? '')}</th>`);
  }
  parts.push('</tr></thead><tbody>');
  for (let r = 0; r < dataRows.length; r++) {
    parts.push('<tr>');
    parts.push(`<td style="text-align: right; color: var(--vscode-descriptionForeground);">${r + (hostHeader ? 1 : 2)}</td>`);
    for (let c = 0; c < colCount; c++) {
      parts.push(`<td>${escapeAttr(dataRows[r][c] ?? '')}</td>`);
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table></div>');

  const count = dataRows.length;
  const hint = asciiPreviewState.truncated
    ? fmt(L, 'dsRowsLoadedTruncated', count)
    : fmt(L, 'dsRowsLoaded', count);
  // ODBC needs its own footnote instead of "first row is the header": empty
  // fields there are ambiguous (NULL and the empty string look the same), and
  // very large integers lose precision inside TM1's ODBC read.
  const note = asciiPreviewState.header ? L.dsOdbcPreviewNote : L.dsFirstRowHeader;
  parts.push(`<div style="margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 11px;">${hint} ${note}</div>`);
  box.innerHTML = parts.join('');
}

function flashButton(id: string, text: string): void {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) { return; }
  const original = btn.textContent;
  btn.textContent = '✓ ' + text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

export function getDataSource(): DataSource {
  return cleanDataSource(current);
}

export function setOnChange(cb: () => void): void {
  onChangeCb = cb;
}

export function renderDataSource(ds: DataSource): void {
  current = normalizeReadDataSource(ds);
  rerender();
}

/**
 * TM1 returns ASCII DataSource fields under different names than it expects on write.
 * Map the server's read format (DataSourceASCIIDelimiter, etc.) to our canonical
 * save format (Delimiter, etc.) so the UI shows the values and saves them correctly.
 */
const normalizeReadDataSource = _pureNormalize;
const cleanDataSource = _pureClean;
const escapeAttr = _pureEscapeAttr;

function notifyChange(): void {
  updateTabIndicator();
  if (onChangeCb) { onChangeCb(); }
}

function updateTabIndicator(): void {
  const ind = document.getElementById('ds-type-indicator');
  if (ind) {
    ind.textContent = current.Type === 'None' ? '' : `(${current.Type})`;
  }
}

function rerender(): void {
  const container = document.getElementById('ds-container');
  if (!container) { return; }

  let fieldsHtml = '';
  let actionsHtml = '';
  let extraHtml = '';

  const typeRow = (() => {
    let h = `<div class="ds-row"><label>${L.dsType}</label><select id="ds-type">`;
    for (const t of TYPES) {
      h += `<option value="${t}"${current.Type === t ? ' selected' : ''}>${t}</option>`;
    }
    h += '</select></div>';
    return h;
  })();

  if (current.Type === 'ASCII') {
    const a = renderAscii();
    fieldsHtml = a.fields;
    actionsHtml = a.actions;
    extraHtml = a.extra;
  } else if (current.Type === 'ODBC') {
    const a = renderOdbc();
    fieldsHtml = a.fields;
    actionsHtml = a.actions;
    extraHtml = a.extra;
  } else if (current.Type === 'TM1CubeView') {
    const a = renderCubeView();
    fieldsHtml = a.fields;
    actionsHtml = a.actions;
  } else if (current.Type === 'TM1DimensionSubset') {
    const a = renderDimSubset();
    fieldsHtml = a.fields;
    actionsHtml = a.actions;
  }

  const parts: string[] = [];
  parts.push('<div class="ds-form">');
  parts.push(`<div class="ds-fields">${typeRow}`);
  if (fieldsHtml) { parts.push(fieldsHtml); }
  parts.push('</div>');

  if (current.Type === 'None') {
    parts.push(`<p class="params-empty">${L.dsNoneConfigured}</p>`);
  }

  if (actionsHtml) { parts.push(`<div class="ds-actions">${actionsHtml}</div>`); }
  if (extraHtml) { parts.push(extraHtml); }

  parts.push('</div>');
  closeTitleCombo();
  container.innerHTML = parts.join('');
  // Cubes, views, dimensions, subsets run into the hundreds: filterable list
  // on top of each server select (filterCombo.ts); the select keeps the value.
  container.querySelectorAll<HTMLSelectElement>('.ds-row select[data-field]').forEach((sel) => {
    sel.classList.add('combo-carrier');
    mountTitleCombo(sel);
  });
  bindEvents();
  updateTabIndicator();
  ensureServerData();
}

function ensureServerData(): void {
  if (!bridge) { return; }
  if (current.Type === 'TM1CubeView') {
    if (cache.cubes === null) { bridge.fetchCubes(); }
    const cube = current.dataSourceNameForServer;
    if (cube && cache.viewsByCube[cube] === undefined) { bridge.fetchViews(cube); }
  }
  if (current.Type === 'TM1DimensionSubset') {
    if (cache.dimensions === null) { bridge.fetchDimensions(); }
    const dim = current.dataSourceNameForServer;
    if (dim && cache.subsetsByDim[dim] === undefined) { bridge.fetchSubsets(dim); }
  }
  if (current.Type === 'ODBC') {
    if (cache.odbcDsns === null) { bridge.fetchOdbcDsns(); }
  }
}

function renderAscii(): { fields: string; actions: string; extra: string } {
  const fields: string[] = [];
  fields.push(field(L.dsFileServer, 'dataSourceNameForServer', current.dataSourceNameForServer));
  fields.push(field(L.dsFileClient, 'dataSourceNameForClient', current.dataSourceNameForClient));
  fields.push(field('Delimiter', 'Delimiter', current.Delimiter));
  fields.push(field(L.dsQuoteChar, 'QuoteCharacter', current.QuoteCharacter));
  fields.push(field(L.dsDecimalSep, 'DecimalSeparator', current.DecimalSeparator));
  fields.push(field(L.dsThousandSep, 'ThousandSeparator', current.ThousandSeparator));
  fields.push(field(L.dsHeaderRows, 'NumberOfHeaderRecordsToSkip', current.NumberOfHeaderRecordsToSkip, 'number'));
  // No Unicode checkbox for ASCII: TM1 refuses the property for this type
  // (`400 code 248 … "usesUnicode"`, measured 2026-08-17), so ticking it made
  // every save fail and took the process code with it. The flag exists only in
  // the .pro file for ASCII sources.

  const actions = [
    `<button type="button" id="btn-ds-ascii-preview" class="add-param-btn" data-limit="10">${L.dsFirst10Rows}</button>`,
    `<button type="button" id="btn-ds-ascii-preview-100" class="add-param-btn" data-limit="100">${L.dsFirst100Rows}</button>`,
    `<button type="button" id="btn-ds-ascii-vars" class="add-param-btn">${L.dsVarsFromHeader}</button>`,
  ].join('');

  const extra = '<div id="ds-ascii-preview-box"></div>';

  return { fields: fields.join(''), actions, extra };
}

function renderOdbc(): { fields: string; actions: string; extra: string } {
  const fields: string[] = [];
  fields.push(fieldWithList('DSN', 'dataSourceNameForServer', current.dataSourceNameForServer, 'odbc-dsn-list', cache.odbcDsns));
  fields.push(field(L.dsUsername, 'UserName', current.UserName));
  // Empty on purpose — the stored value is ciphertext and must not be echoed.
  // The placeholder carries the state instead, so nobody reads the blank field
  // as "no password". In a template there is no field at all: nothing typed
  // there could be kept, so a note says where the password belongs instead.
  const pw = odbcPasswordRow(host, !!current.hasStoredPassword);
  fields.push(pw.kind === 'field'
    ? field(L.dsPassword, 'Password', current.Password, 'password',
      pw.placeholder === 'stored' ? L.dsPasswordStored : L.dsPasswordUnset)
    : `<div class="ds-row"><label>${L.dsPassword}</label>`
      + `<span style="color: var(--vscode-descriptionForeground); font-size: 11px;">`
      + `${L.dsPasswordNotInTemplate}</span></div>`);
  fields.push(checkbox('Unicode (UTF-8)', 'UsesUnicode', current.UsesUnicode));
  fields.push(`<div class="ds-row full">${textareaInner(L.dsSqlQuery, 'Query', current.Query)}</div>`);

  const disabled = current.Query && String(current.Query).trim() ? '' : ' disabled';
  const actions = [
    `<button type="button" id="btn-ds-odbc-preview" class="add-param-btn" data-limit="10"${disabled}>${L.dsFirst10Rows}</button>`,
    `<button type="button" id="btn-ds-odbc-preview-100" class="add-param-btn" data-limit="100"${disabled}>${L.dsFirst100Rows}</button>`,
    `<button type="button" id="btn-ds-odbc-vars" class="add-param-btn"${disabled}>${L.dsVarsFromSelect}</button>`,
    `<span style="color: var(--vscode-descriptionForeground); font-size: 11px;">${L.dsVarsFromSelectHint}</span>`,
  ].join('');
  const extra = renderOdbcDatalist(cache.odbcDsns) + '<div id="ds-odbc-preview-box"></div>';
  return { fields: fields.join(''), actions, extra };
}

function renderOdbcDatalist(items: string[] | null): string {
  if (!items || items.length === 0) { return ''; }
  const opts = items.map(n => `<option value="${escapeAttr(n)}"></option>`).join('');
  return `<datalist id="odbc-dsn-list">${opts}</datalist>`;
}

function fieldWithList(label: string, key: string, value: unknown, listId: string, items: string[] | null): string {
  const v = value === undefined || value === null ? '' : String(value);
  const placeholder = items === null ? L.dsLoadingDsnList : (items.length === 0 ? L.dsDsnListNeedsTm1112 : '');
  return `<div class="ds-row"><label>${label}</label><input type="text" data-field="${key}" list="${listId}" value="${escapeAttr(v)}" placeholder="${escapeAttr(placeholder)}"></div>`;
}

function renderCubeView(): { fields: string; actions: string } {
  const fields: string[] = [];
  fields.push(serverSelect('Cube', 'dataSourceNameForServer', current.dataSourceNameForServer, cache.cubes));
  const views = current.dataSourceNameForServer ? cache.viewsByCube[current.dataSourceNameForServer] : undefined;
  fields.push(serverSelect('View', 'view', current.view, views));

  const disabled = current.dataSourceNameForServer ? '' : ' disabled';
  const actions = [
    `<button type="button" id="btn-ds-cube-vars" class="add-param-btn"${disabled}>${L.dsVarsFromCube}</button>`,
    `<span style="color: var(--vscode-descriptionForeground); font-size: 11px;">${L.dsVarsFromCubeHint}</span>`,
  ].join('');
  return { fields: fields.join(''), actions };
}

function renderDimSubset(): { fields: string; actions: string } {
  const fields: string[] = [];
  fields.push(serverSelect('Dimension', 'dataSourceNameForServer', current.dataSourceNameForServer, cache.dimensions));
  const subsets = current.dataSourceNameForServer ? cache.subsetsByDim[current.dataSourceNameForServer] : undefined;
  fields.push(serverSelect('Subset', 'subset', current.subset, subsets));

  const disabled = current.dataSourceNameForServer ? '' : ' disabled';
  const actions = [
    `<button type="button" id="btn-ds-dim-vars" class="add-param-btn"${disabled}>${L.dsVarFromDim}</button>`,
    `<span style="color: var(--vscode-descriptionForeground); font-size: 11px;">${L.dsVarFromDimHint}</span>`,
  ].join('');
  return { fields: fields.join(''), actions };
}

function serverSelect(label: string, key: string, selected: unknown, items: string[] | null | undefined): string {
  const sel = selected === undefined || selected === null ? '' : String(selected);
  const loading = items === undefined || items === null;
  let html = `<div class="ds-row"><label>${label}</label><select data-field="${key}">`;
  if (loading) {
    html += `<option value="">${L.loading}</option>`;
    if (sel) { html += `<option value="${escapeAttr(sel)}" selected>${escapeAttr(sel)}</option>`; }
  } else {
    html += `<option value="">${L.dsNone}</option>`;
    const list = items ?? [];
    const hasCurrent = sel && list.includes(sel);
    if (sel && !hasCurrent) {
      html += `<option value="${escapeAttr(sel)}" selected>${fmt(L, 'dsNotOnServer', escapeAttr(sel))}</option>`;
    }
    for (const it of list) {
      html += `<option value="${escapeAttr(it)}"${it === sel ? ' selected' : ''}>${escapeAttr(it)}</option>`;
    }
  }
  html += '</select></div>';
  return html;
}

function field(label: string, key: string, value: unknown, inputType: string = 'text', placeholder = ''): string {
  const v = value === undefined || value === null ? '' : String(value);
  const ph = placeholder ? ` placeholder="${escapeAttr(placeholder)}"` : '';
  return `<div class="ds-row"><label>${label}</label><input type="${inputType}" data-field="${key}" value="${escapeAttr(v)}"${ph}></div>`;
}


function textareaInner(label: string, key: string, value: unknown): string {
  const v = value === undefined || value === null ? '' : String(value);
  return `<label>${label}</label><textarea data-field="${key}" style="min-height: 120px;">${escapeAttr(v)}</textarea>`;
}

function checkbox(label: string, key: string, value: unknown): string {
  const checked = value === true ? ' checked' : '';
  return `<div class="ds-row"><label>${label}</label><input type="checkbox" data-field="${key}" data-bool="1"${checked}></div>`;
}

function bindEvents(): void {
  const container = document.getElementById('ds-container');
  if (!container) { return; }

  const typeSel = container.querySelector<HTMLSelectElement>('#ds-type');
  if (typeSel) {
    typeSel.addEventListener('change', () => {
      current = { Type: typeSel.value as DataSourceType };
      asciiPreviewState = null;
      notifyChange();
      rerender();
    });
  }

  // Preview buttons
  const bindPreviewBtn = (id: string) => {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn || !bridge) { return; }
    btn.addEventListener('click', () => {
      const filePath = current.dataSourceNameForServer ?? '';
      if (!filePath) {
        asciiPreviewState = { rows: [], headerRecords: 0, error: L.dsEnterPathFirst, boxId: 'ds-ascii-preview-box' };
        renderAsciiPreviewBox();
        return;
      }
      const maxLines = Number(btn.dataset.limit ?? 50);
      asciiPreviewState = { rows: [], headerRecords: current.NumberOfHeaderRecordsToSkip ?? 0, boxId: 'ds-ascii-preview-box' };
      renderAsciiPreviewBox(L.loading);
      if (!bridge) { return; }
      bridge.fetchAsciiPreview({
        filePath,
        delimiter: current.Delimiter ?? ',',
        quoteChar: current.QuoteCharacter ?? '"',
        headerRecords: current.NumberOfHeaderRecordsToSkip ?? 0,
        maxLines,
      });
    });
  };
  bindPreviewBtn('btn-ds-ascii-preview');
  bindPreviewBtn('btn-ds-ascii-preview-100');

  // ODBC — same two buttons, but the rows come back through a rejected record
  // (see commands/processEditor/odbcPreviewPure.ts), so no header row is read
  // from the data and the host supplies the column labels.
  const bindOdbcPreviewBtn = (id: string) => {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn || !bridge) { return; }
    btn.addEventListener('click', () => {
      if (!(current.Query ?? '').trim()) {
        asciiPreviewState = { rows: [], headerRecords: 0, error: L.dsEnterQueryFirst, boxId: 'ds-odbc-preview-box' };
        renderAsciiPreviewBox();
        return;
      }
      asciiPreviewState = { rows: [], headerRecords: 0, header: [], boxId: 'ds-odbc-preview-box' };
      renderAsciiPreviewBox(L.loading);
      if (!bridge) { return; }
      bridge.fetchOdbcPreview({
        dataSource: getDataSource(),
        variableNames: getVariableNames(),
        maxRows: Number(btn.dataset.limit ?? 10),
      });
    });
  };
  bindOdbcPreviewBtn('btn-ds-odbc-preview');
  bindOdbcPreviewBtn('btn-ds-odbc-preview-100');

  // ASCII — use header row as variables
  const asciiVarsBtn = document.getElementById('btn-ds-ascii-vars') as HTMLButtonElement | null;
  if (asciiVarsBtn && bridge) {
    asciiVarsBtn.addEventListener('click', () => {
      const header = asciiPreviewState?.rows?.[0];
      if (!header || header.length === 0) {
        asciiPreviewState = { rows: [], headerRecords: 0, error: L.dsLoadPreviewFirst, boxId: 'ds-ascii-preview-box' };
        renderAsciiPreviewBox();
        return;
      }
      const variables = header.map((col, idx) => ({
        Name: 'v' + (col.trim() || `Col${idx + 1}`).replace(/[^A-Za-z0-9_]/g, ''),
        Type: 'String' as const,
        Position: idx + 1,
      }));
      bridge!.applyVariables(variables);
      flashButton('btn-ds-ascii-vars', fmt(L, 'dsVarsSet', variables.length));
    });
  }

  // TM1CubeView — derive variables from cube dimensions
  const cubeVarsBtn = document.getElementById('btn-ds-cube-vars') as HTMLButtonElement | null;
  if (cubeVarsBtn && bridge) {
    cubeVarsBtn.addEventListener('click', () => {
      const cube = current.dataSourceNameForServer ?? '';
      if (!cube) { return; }
      cubeVarsBtn.disabled = true;
      cubeVarsBtn.textContent = L.dsLoadingDimensions;
      bridge!.fetchCubeDimensions(cube);
    });
  }

  // TM1DimensionSubset — derive variable from dimension
  const dimVarsBtn = document.getElementById('btn-ds-dim-vars') as HTMLButtonElement | null;
  if (dimVarsBtn && bridge) {
    dimVarsBtn.addEventListener('click', () => {
      const dim = current.dataSourceNameForServer ?? '';
      if (!dim) { return; }
      const variables = [{ Name: 'v' + dim, Type: 'String' as const, Position: 1 }];
      bridge!.applyVariables(variables);
      flashButton('btn-ds-dim-vars', L.dsOneVarSet);
    });
  }

  // ODBC — derive variables by parsing the SELECT column list
  const odbcVarsBtn = document.getElementById('btn-ds-odbc-vars') as HTMLButtonElement | null;
  if (odbcVarsBtn && bridge) {
    odbcVarsBtn.addEventListener('click', () => {
      const cols = parseOdbcSelectColumns(String(current.Query ?? ''));
      if (cols.length === 0) {
        flashButton('btn-ds-odbc-vars', L.dsNoColumns);
        return;
      }
      const variables = cols.map((col, idx) => ({
        Name: 'v' + col,
        Type: 'String' as const,
        Position: idx + 1,
      }));
      bridge!.applyVariables(variables);
      flashButton('btn-ds-odbc-vars', fmt(L, 'dsVarsSet', variables.length));
    });
  }

  container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-field]').forEach(el => {
    const isCheckbox = el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox';
    const isSelect = el.tagName === 'SELECT';
    const evt = isCheckbox || isSelect ? 'change' : 'input';
    el.addEventListener(evt, () => {
      const field = el.dataset.field as keyof DataSource;
      if (!field) { return; }
      if (isCheckbox) {
        (current as any)[field] = (el as HTMLInputElement).checked;
      } else if ((el as HTMLInputElement).type === 'number') {
        const n = Number((el as HTMLInputElement).value);
        (current as any)[field] = Number.isFinite(n) ? n : 0;
      } else {
        (current as any)[field] = el.value;
      }

      // Cascading cleanup when the parent (cube/dimension) changes
      if (field === 'dataSourceNameForServer') {
        if (current.Type === 'TM1CubeView') { current.view = ''; }
        if (current.Type === 'TM1DimensionSubset') { current.subset = ''; }
        rerender();
      }

      notifyChange();
    });
  });
}
