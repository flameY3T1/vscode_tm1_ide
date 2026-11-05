export {};

import { getL10n, fmt } from '../_shared/l10n';
import { markedNames } from './viewMarks';
import { state } from './state';
import { insertNamesAt, setToLevelBase } from './viewPath';
import { showLevelPicks, levelPicks } from './levelPick';
import { pickParent, clearParentPicks, parentPicksFor } from './parentPick';
import { currentRows, applyCtxAction } from './viewPath';
import type { CtxAction } from './ctxIntents';
import { writeClipboard } from '../_shared/clipboardWrite';
import { hierKey, memberMdxRef } from '../../utils/hierKeyPure';

const L = getL10n();

/**
 * The context menu of the NEW load path.
 *
 * Until now a right-click there opened nothing at all: the old listener looks
 * for `tr[data-row-idx]`, the new path writes `data-idx` - no match, no menu, no
 * message. A silent failure (click test 2026-08-22).
 *
 * This module shares the `#ctx-menu` markup with the old path, but NOT its
 * handlers: those write into a state that the new path does not draw. What an
 * entry means is defined in `ctxIntents.ts`; what it triggers, in
 * `viewPath.ts#applyCtxAction`. Here is only what the menu SHOWS.
 */

/** Markup id <-> action. The order is that of the menu. */
const ENTRIES: Array<[string, CtxAction]> = [
  ['ctx-only-this', 'only-this'],
  ['ctx-show-parents', 'show-parents'],
  ['ctx-show-all-parents', 'show-all-parents'],
  ['ctx-leaves', 'leaves'],
  ['ctx-elem-plus-leaves', 'elem-plus-leaves'],
  ['ctx-insert-above', 'insert-above'],
  ['ctx-insert-below', 'insert-below'],
  ['ctx-expand-all', 'expand-all'],
  ['ctx-expand-to-level', 'expand-to-level'],
  ['ctx-clear-all', 'clear-all'],
  ['ctx-collapse-all', 'collapse-all'],
];

let bound = false;
let ctxMember = '';
/**
 * The POSITION of the clicked row - `pick-parent` inserts the parent exactly
 * there. The name alone is not enough: the same name occurs under several
 * parents, and the clicked occurrence is the one meant.
 */
let ctxIdx = -1;
/**
 * The LEVEL of the clicked row. "Expand to level" computes the distance
 * downwards from it: the menu names levels, `DESCENDANTS` knows only distances.
 */
let ctxLevel = 0;
/** The CAPTION of the clicked row - "Copy name" outputs it. */
let ctxLabel = '';

function el(id: string): HTMLElement | null {
  return document.getElementById(id) as HTMLElement | null;
}

/**
 * "Copy name" - the only entry that pushes NO intent onto the stack but merely
 * outputs the clicked name.
 *
 * Until 2026-08-23 it lived in `contextMenu.ts` (the menu of the old path) and
 * moved here when that was dismantled. This module sets `state._ctxName`
 * itself, on opening.
 */
function bindCopyNames(): void {
  const e = el('ctx-copy-name');
  if (!e) { console.warn('[dimbrowser] ctx-copy-name missing from the markup'); return; }
  e.addEventListener('click', () => {
    // What is DISPLAYED, not the base name (click test flameY3T1, 2026-08-23).
    const name = ctxLabel || state._ctxName;
    if (!name) { return; }
    hide();
    void writeClipboard(name);
  });
  const m = el('ctx-copy-mdx');
  if (!m) { console.warn('[dimbrowser] ctx-copy-mdx missing from the markup'); return; }
  m.addEventListener('click', () => {
    // The base name, not the caption: MDX resolves principal names.
    const name = state._ctxName;
    if (!name || !state._currentDim) { return; }
    hide();
    void writeClipboard(memberMdxRef(hierKey(state._currentDim, state._currentHier), name));
  });
}

/**
 * Close the menu on a click outside it, on Escape and when the webview loses
 * focus. A click into another panel (Cube Viewer beside it) never reaches this
 * document; only `blur` tells. Without these the menu stayed open until an
 * entry was picked.
 */
function bindOutsideClose(): void {
  // Test doubles may lack the listener API; real webviews always have it.
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function'
    || typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    console.warn('[dimbrowser] document/window.addEventListener missing — context menu outside-close not bound');
    return;
  }
  document.addEventListener('mousedown', (e) => {
    const m = el('ctx-menu');
    if (m && m.style.display !== 'none' && !m.contains(e.target as Node | null)) { hide(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hide(); } }, true);
  window.addEventListener('blur', hide);
}

function hide(): void {
  const m = el('ctx-menu');
  if (m) { m.style.display = 'none'; }
}

/**
 * Click on an entry of the parent submenu.
 *
 * Bound to the CONTAINER, because the list is rewritten on every opening - a
 * binding on the entry would be lost in the process (same consideration as for
 * the trace). It is bound ONCE during wiring, not in `openMenu()`: the container
 * is permanently in the markup, and binding from within `openMenu()` attached
 * another listener on every right-click. After ten right-clicks, one click on a
 * parent entry triggered ten `pickParent` calls - ten intents on the stack and
 * ten server requests.
 */
function bindParentChoice(): void {
  const host = el('ctx-show-parents-sub');
  if (!host) {
    console.warn('[dimbrowser] ctx-show-parents-sub missing from the markup');
    return;
  }
  host.addEventListener('click', (e: Event) => {
    const target = (e as unknown as { target?: { dataset?: { parent?: string } } }).target;
    const p = target && target.dataset ? target.dataset.parent : '';
    if (!p) { return; }
    hide();
    pickParent(p, ctxIdx);
  });
}

/**
 * Click on an entry of the level submenu.
 *
 * Bound to the CONTAINER and ONCE - same consideration as for the parent
 * choice: the list is rewritten on every opening.
 */
function bindLevelChoice(): void {
  const host = el('ctx-expand-to-level-sub');
  if (!host) {
    console.warn('[dimbrowser] ctx-expand-to-level-sub missing from the markup');
    return;
  }
  host.addEventListener('click', (e: Event) => {
    const target = (e as unknown as { target?: { dataset?: { level?: string } } }).target;
    const raw = target && target.dataset ? target.dataset.level : undefined;
    if (raw === undefined || raw === '') { return; }
    const n = Number(raw);
    // Level 0 is the leaves - a valid choice, so do NOT test against 0.
    if (!Number.isFinite(n) || n < 0) { return; }
    hide();
    setToLevelBase(ctxMember, n, ctxLevel);
  });
}

/**
 * Open the menu at the mouse position and label the entries.
 *
 * There are no greyed-out entries any more: since "Alias" is gone (2026-08-25),
 * EVERY entry can do something. An entry that merely stands there is no
 * information - it is a promise that the row does not keep, and that is exactly
 * how the dead alias entry behaved: arrow, empty submenu, no click handler,
 * because `ENTRIES` never bound it.
 */
function openMenu(
  member: string, level: number,
  ev: { clientX: number; clientY: number; preventDefault(): void },
): void {
  const menu = el('ctx-menu');
  if (!menu) { return; }
  ev.preventDefault();
  ctxMember = member;
  ctxLevel = level;
  const ctx = { member, marked: markedNames() };

  const onlyThis = el('ctx-only-this');
  if (onlyThis) {
    const n = ctx.marked.length;
    onlyThis.textContent = n > 1
      ? fmt(L, 'ctxOnlyThese', ` (${n})`)
      : (L.ctxOnlyThis ?? 'Only this element');
  }
  // The submenus of the old path (parents, alias) stay closed - their contents
  // come from `state`, which the new path does not maintain.
  el('ctx-show-parents')?.classList.remove('ctx-submenu-open');

  // The parent list belongs to the PREVIOUS element: clear it, then ask for this one.
  //
  // Until 2026-08-25 opening did neither. The query was made only on CLICKING
  // the entry, and that hides the menu beforehand - so the answer filled an
  // invisible submenu. Because the CSS opens the submenu only on
  // `.ctx-multi:hover` and only the answer sets `ctx-multi`, not even the arrow
  // was visible on the first right-click; on the second, the parents of the
  // FIRST element were shown (click test flameY3T1).
  //
  // The price is one targeted query per right-click (`recursive: false`, one
  // element). It is the reason why the arrow can tell the truth at all: without
  // it the menu does not know on opening whether parents exist.
  clearParentPicks();
  applyCtxAction('show-parents', member);

  // The levels beneath THIS element. No fetch needed - the row's level is
  // already known; a leaf does not get to see the entry at all.
  showLevelPicks(level);

  menu.style.display = 'block';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = ev.clientX, y = ev.clientY;
  if (x + mw > window.innerWidth) { x = window.innerWidth - mw - 6; }
  if (y + mh > window.innerHeight) { y = window.innerHeight - mh - 6; }
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

/**
 * Bind once. Idempotent, because `startView` runs on every dimension change -
 * a second listener would execute every action twice.
 */
export function initViewCtx(): void {
  if (bound) { return; }
  bound = true;

  const body = el('table-body');
  if (!body) {
    // No silent fallback: without a table body there is no menu, and that is a
    // wiring error, not a valid situation.
    console.warn('[dimbrowser] table-body missing — context menu on the new path not bound');
    return;
  }
  bindCopyNames();
  bindParentChoice();
  bindLevelChoice();
  bindOutsideClose();
  body.addEventListener('contextmenu', (e: Event) => {
    const ev = e as unknown as {
      target?: { closest?(s: string): { getAttribute(a: string): string | null } | null };
      clientX: number; clientY: number; preventDefault(): void;
    };
    const tr = ev.target && ev.target.closest ? ev.target.closest('tr[data-idx]') : null;
    if (!tr) { hide(); return; }
    const idx = Number(tr.getAttribute('data-idx'));
    const row = currentRows()[idx];
    if (!row) { hide(); return; }
    // `state._ctxName` for the DIRECT actions: "Copy name" is not a set
    // operation, the old handler may keep performing it (see `ctxIntents`)
    // - but it reads the name from there, and only the OLD menu set it.
    // Without this it silently returned (click test 2026-08-23).
    state._ctxName = row.name;
    ctxIdx = idx;
    ctxLabel = row.caption || row.name;
    openMenu(row.name, row.level, ev);
  });

  for (const [id, action] of ENTRIES) {
    const e = el(id);
    if (!e) {
      console.warn(`[dimbrowser] context entry ${id} missing from the markup`);
      continue;
    }
    e.addEventListener('click', () => {
      const target = ctxMember;
      hide();
      if (action === 'insert-above' || action === 'insert-below') {
        // Reading the clipboard is asynchronous - hence here and not in
        // `applyCtxAction`, which decides synchronously. Dim/hier need NOT be
        // re-checked here: `insertNamesAt` works on the rows of the current
        // view, and a switch in between resets them.
        const nav = navigator as Navigator & { clipboard?: { readText?: () => Promise<string> } };
        if (!nav.clipboard || !nav.clipboard.readText) { return; }
        nav.clipboard.readText().then((text) => {
          const names = (text || '').split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
          insertNamesAt(target, action === 'insert-below', names);
        }).catch(() => { /* read permission denied */ });
        return;
      }
      if (action === 'show-parents') {
        // The list is already there (opening fetched it). Exactly ONE parent:
        // there is nothing to choose, the click takes it directly - a submenu
        // with a single entry would be a question without an alternative.
        // Several: the submenu is the choice, a click on the row itself means
        // nothing. No answer yet: likewise nothing - a second `drillAncestors`
        // would only make one more request out of it.
        const parents = parentPicksFor(target);
        if (parents && parents.length === 1) { pickParent(parents[0]!, ctxIdx); }
        return;
      }
      if (action === 'expand-to-level') {
        // The level comes from the submenu (`levelPick.ts`), no longer from a
        // modal with a free number: only what exists beneath the element is
        // offered. Exactly one level means there is nothing to choose - then
        // the click on the row takes it directly, as with "Show parents" with a
        // single parent.
        const levels = levelPicks();
        if (levels.length === 1) { setToLevelBase(target, levels[0]!, ctxLevel); }
        return;
      }
      applyCtxAction(action, target);
    });
  }
}

