export {};

import { getL10n, fmt } from '../_shared/l10n';

/**
 * "Expand to level" — the submenu with the levels that actually EXIST below
 * the clicked element (decision by flameY3T1, 2026-08-31).
 *
 * Before, a modal asked for a free number. A number that does not exist below
 * the element is not a choice, though — it returns the empty set, and that
 * looked like an error. The submenu can only offer correct answers, and the
 * entry is still named after what it does: the descendants restricted to
 * EXACTLY one level (`viewMdx.ts#toLevelMdx`, `TM1FILTERBYLEVEL`).
 *
 * The list costs NO server call: TM1's element level is the height above the
 * leaves (leaf = 0), and the row already carries it
 * (`AnswerRow.level`, `$select=…,Level`). Below an element of level k lie
 * the levels 0 to k-1; the element's own level is not offered, it would be
 * the element itself.
 */

const L = getL10n();

/** The selectable levels below an element of level `level`, leaves first. */
export function levelChoices(level: number): number[] {
  if (!Number.isFinite(level) || level < 1) { return []; }
  const out: number[] = [];
  for (let n = 0; n < level; n++) { out.push(n); }
  return out;
}

/** Label of a level. Level 0 also says that it is the leaves. */
export function levelLabel(n: number): string {
  return n === 0 ? (L.ctxLevelLeaves ?? 'Level 0 (leaves)') : fmt(L, 'ctxLevelN', n);
}

/**
 * Fill the submenu — when the context menu opens, from the row.
 *
 * A leaf does not get to see the entry at all: there is nothing below it, and
 * an entry that merely sits there is a promise the row does not keep
 * (the same reasoning as for the alias entry, which was dropped on 2026-08-25).
 */
export function showLevelPicks(level: number): void {
  const entry = document.getElementById('ctx-expand-to-level');
  const host = document.getElementById('ctx-expand-to-level-sub');
  const levels = levelChoices(level);
  if (entry) {
    entry.style.display = levels.length ? '' : 'none';
    // Exactly one level: nothing to choose, a click on the entry takes it
    // directly — like "Show parents" with a single parent.
    entry.classList[levels.length > 1 ? 'add' : 'remove']('ctx-multi');
  }
  if (!host) { return; }
  host.innerHTML = '';
  for (const n of levels) {
    const item = document.createElement('div');
    item.className = 'ctx-submenu-item';
    item.textContent = levelLabel(n);
    (item as HTMLElement).dataset.level = String(n);
    host.appendChild(item);
  }
}

/** The levels of the list shown last — `[]` as long as there is none. */
export function levelPicks(): number[] {
  const host = document.getElementById('ctx-expand-to-level-sub');
  if (!host) { return []; }
  const out: number[] = [];
  for (const kind of Array.from(host.children)) {
    const n = Number((kind as HTMLElement).dataset?.level);
    if (Number.isFinite(n) && n >= 0) { out.push(n); }
  }
  return out;
}
