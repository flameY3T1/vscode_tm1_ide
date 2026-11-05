/** Pure helpers for threads webview — no vscode dependencies. */

/** Parse ISO 8601 duration (`PnDTnHnMnS`) to total seconds. Returns 0 for empty/unparsable. */
export function parseIsoDuration(d: string): number {
  if (!d) { return 0; }
  const m = d.match(/P(\d+)DT(\d+)H(\d+)M(\d+)S/);
  if (!m) { return 0; }
  return parseInt(m[1], 10) * 86400 + parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
}

/** Format ISO duration to display string (`h:mm:ss` or `m:ss`). Empty when zero. */
export function formatElapsed(isoDur: string): string {
  const totalSec = parseIsoDuration(isoDur);
  if (totalSec === 0) { return ''; }
  const h = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) { return `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
  return `${mm}:${String(s).padStart(2, '0')}`;
}

export type ThreadStateClass = 's-run' | 's-wait' | 's-idle';

export interface ThreadRowExtras {
  TypeLabel: string;
  StateClass: ThreadStateClass;
  Elapsed: string;
}

/** Pure state→CSS-class classifier. */
export function stateClassFor(state: string | undefined): ThreadStateClass {
  if (state === 'Run') { return 's-run'; }
  if ((state ?? '').includes('Wait')) { return 's-wait'; }
  return 's-idle';
}

/** Map raw thread record fields to display-row enrichment. Pure. */
export function mapThreadToRow(t: { Type?: string; State?: string; ElapsedTime?: string }): ThreadRowExtras {
  return {
    TypeLabel: t.Type ?? '',
    StateClass: stateClassFor(t.State),
    Elapsed: formatElapsed(t.ElapsedTime ?? ''),
  };
}
