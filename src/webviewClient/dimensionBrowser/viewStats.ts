import { markCount } from './viewMarks';
import { syncViewControls } from './viewControls';
import { getL10n } from '../_shared/l10n';
import { vr } from './viewRun';

const L = getL10n();

/** How many elements are marked. Hard-coded German - see `viewCount.ts`. */
export function paintMarkCount(): void {
  const el = document.getElementById('vw-mark-count');
  if (el) { el.textContent = markCount() ? `${markCount()} markiert` : ''; }
  syncViewControls();
}

/**
 * Write the counter into the DOM - ALL three displays, not just one.
 *
 * The footer (`visible`/`total`/N/C/S) is otherwise filled exclusively by
 * `render.ts#_paintCounters`, and that never runs in the new path - it
 * therefore stood permanently at its markup start value `0` (click test by flameY3T1,
 * 2026-08-22). The header-row counters next to it ("Available X / Y" plus an
 * unlabeled second number) dropped out of the markup entirely on the same day:
 * the same information, twice, once without a word next to it.
 *
 * N/C/S count the LOADED window, not the set - the label says
 * so ("in window"), because a complete type breakdown would have to load the whole
 * dimension. The same restriction applies in the old path, but there
 * unspoken.
 */
export function paintCounter(): void {
  // The counter at the top right no longer exists - it said the same as the
  // footer, just worded differently (flameY3T1, 2026-08-22).
  const loadedText = vr.rows.length.toLocaleString();
  // `total` is `null` (in flight) or `-1` (count failed) -
  // both mean "unknown". Then a `?` stands there, no invented number;
  // `render.ts` writes the same character in the same case.
  const totalText = vr.total === null || vr.total < 0 ? '?' : vr.total.toLocaleString();
  let n = 0, c = 0, st = 0;
  for (const r of vr.rows) {
    if (r.type === 'N') { n++; } else if (r.type === 'C') { c++; } else if (r.type === 'S') { st++; }
  }
  // No `innerHTML`: number and label each have a node of their own in the
  // markup (`dimensionBrowserBody.ts`), and only their text is written. Sending the
  // structure `<strong>…</strong> …` through the HTML parser five times
  // per response was work for a result that never changes.
  const setStat = (id: string, value: string, suffix: string): void => {
    const nEl = document.getElementById(id + '-n');
    const tEl = document.getElementById(id + '-t');
    if (!nEl || !tEl) {
      // No silent fallback: if the node is missing, markup and script have
      // drifted apart - that is a wiring error, not a situation.
      console.warn(`[dimbrowser] counter field ${id} missing from the markup`);
      return;
    }
    nEl.textContent = value;
    tEl.textContent = suffix;
  };
  setStat('stat-visible', loadedText, L.statVisible ?? '');
  setStat('stat-total', totalText, L.statTotal ?? '');
  const inWindowText = L.vwStatInWindow ?? '';
  setStat('stat-n', n.toLocaleString(), 'N ' + inWindowText);
  setStat('stat-c', c.toLocaleString(), 'C ' + inWindowText);
  setStat('stat-s', st.toLocaleString(), 'S ' + inWindowText);
}
