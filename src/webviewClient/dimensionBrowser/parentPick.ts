/**
 * "Show parents" - the submenu that lists the parents of the clicked element
 * and lets the user pick ONE SPECIFIC one (decision flameY3T1, 2026-08-23).
 *
 * Why a submenu and not an expression: an element can hang under several
 * parents, and the user means ONE of them. That is a selection, not a
 * rule - the old path said the same (`composeModel.ts`, removed 2026-10-04, `mode: 'picked'`:
 * "it is a selection and is stated as a name, not as a rule").
 *
 * The row alone is not enough for that: it only carries ITS occurrence path,
 * i.e. the one parent under which it currently stands. All of them come from the
 * server (`drillAncestors`).
 */
import { pickParentAt } from './viewPath';

interface Edge { ParentName: string; ComponentName: string }

/** All parents of an element from the edges - de-duplicated, in edge order. */
export function parentsFromEdges(edges: readonly Edge[], element: string): string[] {
  const out: string[] = [];
  for (const k of edges) {
    if (k.ComponentName === element && k.ParentName && out.indexOf(k.ParentName) < 0) {
      out.push(k.ParentName);
    }
  }
  return out;
}

/**
 * The most recently shown list and the element it belongs to.
 *
 * The element MUST be included: until 2026-08-25 the list of the previous right-click
 * stayed in place, and at the next element the menu showed that element's parents (click test
 * flameY3T1). Whoever reads the list thereby checks whether it is meant at all.
 */
let last: { element: string; parents: string[] } | null = null;

/** The parents of the element - or `null` when the list belongs to another one. */
export function parentPicksFor(element: string): string[] | null {
  return last && last.element === element ? last.parents.slice() : null;
}

/**
 * CLEAR the submenu - when the menu opens.
 *
 * Without it the next right-click showed the parents of the previous element:
 * it was only filled after the answer, never emptied.
 */
export function clearParentPicks(): void {
  last = null;
  const host = document.getElementById('ctx-show-parents-sub');
  if (host) { host.innerHTML = ''; }
  const entry = document.getElementById('ctx-show-parents');
  if (entry) { entry.classList.remove('ctx-multi'); }
}

/**
 * Fill the submenu.
 *
 * `innerHTML = ''` before filling: the list belongs to the most recently clicked
 * element, and an appended one would be a mixture of two.
 */
export function showParentPicks(parents: readonly string[], element = ''): void {
  last = { element, parents: parents.slice() };
  const host = document.getElementById('ctx-show-parents-sub');
  if (!host) { return; }
  host.innerHTML = '';
  for (const p of parents) {
    const item = document.createElement('div');
    item.className = 'ctx-submenu-item';
    item.textContent = p;
    (item as HTMLElement).dataset.parent = p;
    host.appendChild(item);
  }
  const entry = document.getElementById('ctx-show-parents');
  if (entry) {
    // More than one: the menu shows the arrow and opens up. Exactly one:
    // there is nothing to choose, a click on the entry takes it directly.
    entry.classList[parents.length > 1 ? 'add' : 'remove']('ctx-multi');
  }
}

/**
 * Pick a parent: it is added ABOVE its occurrence.
 *
 * `at` is the position of the clicked row. Without it only the name would be
 * given, and the same name occurs several times - exactly the
 * clicked occurrence is meant.
 *
 * Until 2026-08-25 this went through `addNames`, i.e. `UNION(set, {p}, ALL)`. That
 * appends at the END: the parent stood below the last row instead of above
 * its child (click test flameY3T1).
 */
export function pickParent(name: string, at: number): void {
  pickParentAt(name, at);
}

/** For tests only. */
export function _resetParentPickForTest(): void { last = null; }
