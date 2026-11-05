import type { OverviewRow, ColumnKind, CellValue } from './overviewTypes';

/**
 * Stable sort by a column. Null/undefined always sort last (both directions).
 * `dir` is +1 (asc) or -1 (desc). Number/flag compare numerically; everything
 * else compares as lowercased strings. Arrays (badges) compare by joined text.
 *
 * A column may instead carry an explicit numeric sort key per row (see
 * `OverviewRow.sortValues`) — e.g. RAM displays "1.02 GB" but must order by
 * bytes, since "1.02 GB" < "842 MB" as text. If *any* row supplies one for this
 * column, the whole column sorts numerically on it and rows without a value
 * count as null (last); mixing raw values with formatted labels in a single
 * comparison would order neither correctly.
 */
export function sortRows(rows: OverviewRow[], key: string, dir: 1 | -1, kind: ColumnKind): OverviewRow[] {
  const useSortValue = rows.some(r => r.sortValues?.[key] !== undefined);
  const numeric = useSortValue || kind === 'number' || kind === 'flag';
  const indexed = rows.map((r, i) => [r, i] as const);
  indexed.sort(([a, ia], [b, ib]) => {
    const va = useSortValue ? (a.sortValues?.[key] ?? null) : a.cells[key];
    const vb = useSortValue ? (b.sortValues?.[key] ?? null) : b.cells[key];
    let cmp: number;
    if (numeric) {
      // A failed lazy fetch leaves a "—" placeholder in a number column; it is
      // not a quantity and must sort last instead of collapsing to 0.
      const na = numOrNull(va);
      const nb = numOrNull(vb);
      if (na === null || nb === null) {
        return na === nb ? ia - ib : (na === null ? 1 : -1);
      }
      cmp = na - nb;
    } else {
      const ea = va === null || va === undefined;
      const eb = vb === null || vb === undefined;
      if (ea || eb) {
        return ea === eb ? ia - ib : (ea ? 1 : -1);
      }
      const sa = str(va);
      const sb = str(vb);
      const isSpecialA = isPlaceholderText(sa);
      const isSpecialB = isPlaceholderText(sb);
      if (isSpecialA !== isSpecialB) {
        return isSpecialA ? 1 : -1;
      }
      cmp = sa.localeCompare(sb);
    }
    return cmp !== 0 ? cmp * dir : ia - ib;
  });
  return indexed.map(([r]) => r);
}

/**
 * A string that leads with a non-word, non-space character is a placeholder
 * ("—" for an unresolved/absent value) or a control object ("}Cubes"), not a
 * real value. ICU collation ranks such punctuation BEFORE digits and letters,
 * so `'—'.localeCompare('21:00') === -1` — sorting ascending would stack every
 * placeholder at the TOP. Every overview comparator pushes them last instead,
 * in both directions; this is the single definition of that rule.
 *
 * NOTE: `choreOverviewWebview.ts` injects this function verbatim via
 * `toString()`, so it must stay self-contained (no module-scope references).
 */
export function isPlaceholderText(s: string): boolean {
  return /^[^\w\s]/.test(s);
}

/** Filter by name substring (case-insensitive) and control-object visibility. */
export function filterRows(rows: OverviewRow[], nameFilter: string, showControl: boolean): OverviewRow[] {
  const needle = nameFilter.trim().toLowerCase();
  return rows.filter(r => {
    if (!showControl && r.isControl) { return false; }
    if (needle && !r.id.toLowerCase().includes(needle)) { return false; }
    return true;
  });
}

/** Numeric value of a cell, or null when it does not denote a number at all. */
function numOrNull(v: CellValue): number | null {
  if (typeof v === 'number') { return Number.isNaN(v) ? null : v; }
  if (typeof v === 'boolean') { return v ? 1 : 0; }
  if (typeof v !== 'string' || v.trim() === '') { return null; }
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function str(v: CellValue): string {
  if (Array.isArray(v)) { return v.join(', '); }
  return String(v).toLowerCase();
}
