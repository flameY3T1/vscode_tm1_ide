/**
 * Pure helpers for process-editor DataSource normalization.
 *
 * Extracted from `dataSource.ts` (Hebel 17 — Iter 5). No DOM, no module state.
 *
 * The wire mapping itself moved to `utils/dataSourceWire.ts` so the deploy
 * paths in `commands/` can share it; re-exported here so the webview keeps its
 * single import site. What stays is the SELECT-column parser, which only the
 * editor needs.
 */

export {};

export type { DataSourceType, DataSource } from '../../utils/dataSourceWire';
export { normalizeReadDataSource, cleanDataSource } from '../../utils/dataSourceWire';

export { escapeAttr } from '../htmlUtils';

/**
 * Parse the column list of an ODBC `SELECT … FROM …` query and return clean
 * identifier names suitable for `v<Name>` TI variables.
 *
 * Heuristic best-effort parser — covers the common shapes:
 *  - `SELECT col1, col2 FROM t`                → ['col1', 'col2']
 *  - `SELECT t.col1, t.col2 FROM t`            → ['col1', 'col2']
 *  - `SELECT col1 AS alias1, col2 alias2 FROM` → ['alias1', 'alias2']
 *  - `SELECT "Order Date", [Customer] FROM`    → ['Order_Date', 'Customer']
 *  - `SELECT COUNT(*) AS cnt FROM t`           → ['cnt']
 *  - `SELECT * FROM t`                         → [] (cannot infer)
 *
 * Limitations: subqueries with nested SELECT/FROM and complex CASE/CAST
 * expressions are best-effort; the parser splits on top-level commas (depth
 * 0 across `()`, `[]`, double-quoted strings) and extracts the trailing
 * identifier. Returns empty array when SELECT/FROM cannot be located.
 *
 * Names are normalized: non-`[A-Za-z0-9_]` chars replaced with `_`,
 * leading digit prefixed with `_`. Duplicates removed (keep first).
 */
export function parseOdbcSelectColumns(query: string): string[] {
  const q = String(query || '');
  const match = /\bSELECT\b([\s\S]*?)\bFROM\b/i.exec(q);
  if (!match) { return []; }
  const inner = match[1].trim();
  if (!inner || inner === '*') { return []; }

  const parts = _splitTopLevelCommas(inner);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const name = _extractColumnName(raw.trim());
    if (!name) { continue; }
    const norm = _normalizeName(name);
    if (!norm || seen.has(norm.toLowerCase())) { continue; }
    seen.add(norm.toLowerCase());
    out.push(norm);
  }
  return out;
}

/** Split on `,` at paren/bracket/double-quote depth 0. */
function _splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inDq = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inDq) {
      if (c === '"') { inDq = false; }
      continue;
    }
    if (c === '"') { inDq = true; continue; }
    if (c === '(' || c === '[') { depth++; continue; }
    if (c === ')' || c === ']') { depth--; continue; }
    if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Extract the column name from a single SELECT-list entry.
 *
 * Precedence:
 *  1. `expr AS alias` (case-insensitive AS)
 *  2. `expr alias` — only when `expr` ends with `)` or `]`.
 *  3. `"quoted"` or `[bracketed]` → contents
 *  4. `table.col` → `col`
 *  5. plain identifier → as-is
 *
 * Returns empty string for unrecognized shapes (e.g. bare `*`).
 */
function _extractColumnName(entry: string): string {
  if (!entry) { return ''; }
  const asMatch = /^(.+?)\s+AS\s+(["[]?)([A-Za-z_][A-Za-z0-9_ ]*)\2\s*$/i.exec(entry);
  if (asMatch) { return asMatch[3].trim(); }

  const tail = entry.match(/([)\]])\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (tail) { return tail[2]; }

  const dqMatch = /"([^"]+)"\s*$/.exec(entry);
  if (dqMatch) { return dqMatch[1]; }

  const brMatch = /\[([^\]]+)\]\s*$/.exec(entry);
  if (brMatch) { return brMatch[1]; }

  const dotMatch = /\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(entry);
  if (dotMatch) { return dotMatch[1]; }

  const plain = /^([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(entry);
  if (plain) { return plain[1]; }

  return '';
}

/** Replace non-identifier chars with `_`; prefix leading digit with `_`. */
function _normalizeName(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
  out = out.replace(/^_+|_+$/g, '');
  if (/^\d/.test(out)) { out = '_' + out; }
  return out;
}

/**
 * Which editor the datasource form is embedded in. The process editor talks to
 * a live TM1 process; the template editor only ever writes to a local store.
 */
export type DsHost = 'process' | 'template';

/**
 * What the ODBC password row shows.
 *
 * A template is persisted to globalState and — on export — into a bundle file
 * meant to be handed around, so a password can never be kept for one (see
 * `processTemplates/templatePasswordGuard`). An input that gets silently
 * dropped on save is worse than no input, hence the note instead of the field.
 */
export function odbcPasswordRow(
  host: DsHost,
  hasStoredPassword: boolean,
): { kind: 'field'; placeholder: 'stored' | 'unset' } | { kind: 'note' } {
  if (host === 'template') { return { kind: 'note' }; }
  return { kind: 'field', placeholder: hasStoredPassword ? 'stored' : 'unset' };
}
