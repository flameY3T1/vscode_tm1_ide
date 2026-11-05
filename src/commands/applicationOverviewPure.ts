// src/commands/applicationOverviewPure.ts
// Applications overview: rows/KPIs from the walked tree, plus the workbook scan
// (which cubes and dimensions a Perspectives/PAx workbook names in its formulas).
import JSZip = require('jszip');
import type { AppTreeEntry } from '../tm1Rest/applicationsApi';
import type { KpiValue, OverviewRow } from '../webviews/objectOverview/overviewTypes';

// Which argument names the object, and what kind it is. TM1RPTVIEW writes
// `Server:Cube:ViewId`; the cube is still the part after the first colon.
// The write functions take the value first: DBS/DBSW/DBSS(value, cube, …),
// DBSA(value, dimension, element, attribute). DBRA reads an element
// attribute: its first argument is the dimension (IBM docs, 2026-09-27).
const OBJECT_ARG: Record<string, { arg: number; kind: 'cube' | 'dimension' }> = {};
for (const f of ['DBRW', 'DBR', 'TM1RPTVIEW', 'VIEW']) { OBJECT_ARG[f] = { arg: 0, kind: 'cube' }; }
for (const f of ['DBS', 'DBSW', 'DBSS']) { OBJECT_ARG[f] = { arg: 1, kind: 'cube' }; }
OBJECT_ARG.DBSA = { arg: 1, kind: 'dimension' };
for (const f of ['DBRA', 'SUBNM', 'DIMNM', 'DIMIX', 'DIMSIZ', 'ELLEV', 'ELPAR', 'ELPARN', 'ELCOMP', 'ELCOMPN',
  'ELISANC', 'ELISCOMP', 'ELISPAR', 'ELWEIGHT', 'ELDTYPE', 'ATTRS', 'ATTRN']) { OBJECT_ARG[f] = { arg: 0, kind: 'dimension' }; }

// Only a COMPLETE string literal counts: `DBRW("Srv:Cube",…)`. A literal that is
// concatenated (`"Srv:"&B1`) or a cell reference (`DBRW($B$1,…)`) — the common
// case, ~60,000 of ~60,150 DBRW on the test server — names nothing checkable.
const FUNC_RE = new RegExp(`(?<![A-Za-z0-9_.])(?:_xll\\.)?(${Object.keys(OBJECT_ARG).join('|')})\\(`, 'gi');

/**
 * The `n`-th argument (0-based) of the call whose `(` ends at `from`, if it
 * is one complete string literal; undefined otherwise. Excel escapes `"` as
 * `""`; `,` and `;` both separate arguments (locale).
 */
function literalArg(formula: string, from: number, n: number): string | undefined {
  let depth = 0;
  let arg = 0;
  let start = from;
  for (let i = from; i < formula.length; i++) {
    const c = formula[i];
    if (c === '"') {
      i++;
      while (i < formula.length && !(formula[i] === '"' && formula[i + 1] !== '"')) { i += formula[i] === '"' ? 2 : 1; }
      continue;
    }
    if (c === '(') { depth++; continue; }
    const end = depth === 0 && (c === ',' || c === ';' || c === ')');
    if (c === ')' && depth > 0) { depth--; continue; }
    if (!end) { continue; }
    if (arg === n) {
      const m = /^\s*"((?:[^"]|"")*)"\s*$/.exec(formula.slice(start, i));
      return m ? m[1].replace(/""/g, '"') : undefined;
    }
    if (c === ')') { return undefined; }
    arg++;
    start = i + 1;
  }
  return undefined;
}

/** One object a formula names by string literal. */
export interface WorkbookRef {
  kind: 'cube' | 'dimension';
  server: string;
  name: string;
  /** Sheets whose formulas name it; a defined name counts under its own label. */
  sheets: string[];
}

/** A formula text (already XML-decoded) and where it sits. */
export interface FormulaAt { sheet: string; formula: string }

function decodeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Distinct literal references with the sheets they occur on. Exported for tests. */
export function scanFormulas(formulas: FormulaAt[]): WorkbookRef[] {
  const seen = new Map<string, WorkbookRef>();
  for (const { sheet, formula } of formulas) {
    for (const m of formula.matchAll(FUNC_RE)) {
      const { arg, kind } = OBJECT_ARG[m[1].toUpperCase()];
      const literal = literalArg(formula, m.index + m[0].length, arg);
      if (literal === undefined) { continue; }
      const parts = literal.split(':');
      // No colon = name only (the workbook's default server).
      const [server, name] = parts.length > 1 ? [parts[0], parts[1]] : ['', parts[0]];
      if (!name.trim()) { continue; }
      const key = `${kind}|${tm1NameKey(server)}|${tm1NameKey(name)}`;
      const ref = seen.get(key) ?? { kind, server, name, sheets: [] };
      if (!ref.sheets.includes(sheet)) { ref.sheets.push(sheet); }
      seen.set(key, ref);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Part path → visible sheet name. `sheet3.xml` is not the third tab: the name
 * comes from workbook.xml (`<sheet name r:id>`) via workbook.xml.rels.
 */
export function sheetNames(workbookXml: string, relsXml: string): Map<string, string> {
  const targetById = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[0])?.[1];
    // Target is relative to xl/ ("worksheets/sheet1.xml") or absolute ("/xl/worksheets/sheet1.xml").
    if (id && target) { targetById.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`); }
  }
  const out = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1];
    const part = rid ? targetById.get(rid) : undefined;
    if (name !== undefined && part) { out.set(part, decodeXml(name)); }
  }
  return out;
}

/** Label for references found in defined names (no sheet of their own). */
export const DEFINED_NAMES = '(names)';

/** Unzip an .xlsx/.xlsm and scan its sheet formulas and defined names. `null` = not a workbook. */
export async function scanWorkbook(buf: Buffer): Promise<WorkbookRef[] | null> {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) { return null; }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { return null; }
  const read = async (n: string) => (zip.files[n] ? zip.files[n].async('string') : '');
  const workbookXml = await read('xl/workbook.xml');
  const names = sheetNames(workbookXml, await read('xl/_rels/workbook.xml.rels'));
  const formulas: FormulaAt[] = [];
  for (const m of workbookXml.matchAll(/<definedName[^>]*>([^<]*)<\/definedName>/g)) {
    formulas.push({ sheet: DEFINED_NAMES, formula: decodeXml(m[1]) });
  }
  // Tab order first (the map keeps workbook.xml order), then any sheet part
  // the workbook does not list.
  const parts = [...names.keys(), ...Object.keys(zip.files).filter(n => !names.has(n))];
  for (const part of parts) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(part)) { continue; }
    const sheet = names.get(part) ?? part.replace(/^.*\//, '');
    for (const m of (await read(part)).matchAll(/<f(?:\s[^>]*)?>([^<]*)<\/f>/g)) {
      formulas.push({ sheet, formula: decodeXml(m[1]) });
    }
  }
  return scanFormulas(formulas);
}

/** TM1 compares object names ignoring case and spaces. */
export function tm1NameKey(s: string): string { return s.replace(/\s+/g, '').toLowerCase(); }

/**
 * References the server cannot satisfy. Only names without a server prefix or
 * with THIS server's prefix are checked — another server's cubes cannot be
 * judged from here.
 */
export function missingRefs(refs: WorkbookRef[], serverName: string, cubes: Set<string>, dims: Set<string>): WorkbookRef[] {
  const own = tm1NameKey(serverName);
  return refs.filter(r =>
    (!r.server || tm1NameKey(r.server) === own)
    && !(r.kind === 'cube' ? cubes : dims).has(tm1NameKey(r.name)));
}

/** Badge text: the name, prefixed with a foreign server so it does not pass as ours. */
export function refLabel(r: WorkbookRef, serverName: string): string {
  return r.server && tm1NameKey(r.server) !== tm1NameKey(serverName) ? `${r.server}:${r.name}` : r.name;
}

/** Row id = full path; unique because entry IDs are unique per folder. */
export function appRowId(e: AppTreeEntry): string {
  return [...e.folderPath, e.id].join('/') + (e.isPrivate ? ' (private)' : '');
}

function isWorkbook(e: AppTreeEntry): boolean {
  return e.type === 'document' && /\.xls[xm]{1,2}(\.blob)?$/i.test(e.id);
}

function typeLabel(e: AppTreeEntry, t: (s: string) => string): string {
  switch (e.type) {
    case 'document':
      if (/\.xlsm(\.blob)?$/i.test(e.id)) { return t('Excel (macros)'); }
      return isWorkbook(e) ? t('Excel') : t('Document');
    case 'link': return t('Link');
    case 'viewRef': return t('View reference');
    case 'cubeRef': return t('Cube reference');
    case 'dimensionRef': return t('Dimension reference');
    case 'subsetRef': return t('Subset reference');
    case 'processRef': return t('Process reference');
    case 'choreRef': return t('Chore reference');
    default: return e.type;
  }
}

function targetLabel(e: AppTreeEntry): string {
  const tg = e.target ?? {};
  if (e.type === 'link') { return e.url ?? ''; }
  if (e.type === 'viewRef') { return tg.cubeName && tg.viewName ? `${tg.cubeName} › ${tg.viewName}` : ''; }
  return tg.cubeName ?? tg.dimensionName ?? tg.subsetName ?? tg.processName ?? tg.choreName ?? '';
}

/**
 * Base rows. Lazy cells (`cubes`, `dimensions`, `missing`) start `null` for
 * workbooks; for every other entry they are final right away (`noValue`).
 */
export function buildAppRows(entries: AppTreeEntry[], t: (s: string) => string, noValue: string, formatBytes: (n: number) => string): OverviewRow[] {
  return entries.map((e) => {
    // Every document is scanned: extensionless ones are workbooks too (4 of
    // 112 on the test server). The zip header decides, not the name.
    const wb = e.type === 'document';
    const row: OverviewRow = {
      id: appRowId(e),
      isControl: false,
      cells: {
        name: e.name,
        folder: e.folderPath.join(' / '),
        type: typeLabel(e, t),
        private: e.isPrivate,
        size: e.size !== undefined ? formatBytes(e.size) : noValue,
        updated: e.lastUpdated ? e.lastUpdated.slice(0, 10) : noValue,
        target: targetLabel(e) || noValue,
        cubes: wb ? null : noValue,
        dimensions: wb ? null : noValue,
        missing: e.broken ? [t('target missing')] : (wb ? null : []),
      },
    };
    if (e.size !== undefined) { (row.sortValues ??= {}).size = e.size; }
    // "Missing" sorts by count; documents get theirs with the lazy patch.
    if (!wb) { (row.sortValues ??= {}).missing = e.broken ? 1 : 0; }
    return row;
  });
}

/** Two years, the "stale" line of the KPI tile. */
const STALE_MS = 2 * 365 * 24 * 3600 * 1000;

/** `entries` includes the folders: they only count, they are no rows. */
export function buildAppKpis(entries: AppTreeEntry[], now: number, t: (s: string) => string, formatBytes: (n: number) => string): KpiValue[] {
  const docs = entries.filter(e => e.type === 'document');
  const bytes = docs.reduce((n, e) => n + (e.size ?? 0), 0);
  const stale = docs.filter(e => e.lastUpdated && now - Date.parse(e.lastUpdated) > STALE_MS).map(appRowId);
  const broken = entries.filter(e => e.broken).map(appRowId);
  // One tile per kind actually present, largest first: a server with no links
  // shows no "0 links" tile.
  const byType = new Map<string, string[]>();
  for (const e of entries) {
    if (e.type === 'folder') { continue; }
    const label = typeLabel(e, t);
    byType.set(label, [...(byType.get(label) ?? []), appRowId(e)]);
  }
  const typeTiles = [...byType].sort((a, b) => b[1].length - a[1].length)
    .map(([label, ids]) => ({ key: `type:${label}`, label, value: String(ids.length), rowIds: ids }));
  return [
    { key: 'folders', label: t('Folders'), value: String(entries.filter(e => e.type === 'folder').length) },
    ...typeTiles,
    { key: 'size', label: t('Σ size'), value: formatBytes(bytes) },
    { key: 'stale', label: t('Unchanged > 2 years'), value: String(stale.length), rowIds: stale },
    { key: 'broken', label: t('References without target'), value: String(broken.length), rowIds: broken },
  ];
}
