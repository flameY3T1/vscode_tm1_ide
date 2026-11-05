export const DEFAULT_CAP = 50;

export interface HistoryEntry {
  mdx: string;
  timestamp: number;
  elapsedMs: number;
  rowCount: number;
  colCount: number;
  error?: { code: string; message: string };
}

/**
 * Adds an entry to the history list, with duplicate-bumping (trim-equal
 * existing entries are replaced with the new timestamp) and LRU-style capping
 * (oldest entries evicted when length exceeds `cap`).
 */
export function addEntry(
  entries: HistoryEntry[],
  entry: HistoryEntry,
  cap: number = DEFAULT_CAP,
): HistoryEntry[] {
  const key = entry.mdx.trim();
  const filtered = entries.filter(e => e.mdx.trim() !== key);
  const next = [entry, ...filtered];
  if (next.length > cap) { next.length = cap; }
  return next;
}

export function removeEntry(entries: HistoryEntry[], index: number): HistoryEntry[] {
  if (index < 0 || index >= entries.length) { return entries; }
  return [...entries.slice(0, index), ...entries.slice(index + 1)];
}
