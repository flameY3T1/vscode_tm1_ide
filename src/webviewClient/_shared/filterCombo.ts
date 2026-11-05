/**
 * Searchable dropdown for the title (context) zone.
 *
 * A native `<select>` cannot be filtered, and context dims routinely hold
 * thousands of elements. So the `<select>` stays in the DOM as the value carrier
 * — every reader (`.title-elem-sel` in actions/messaging/viewSave, the change
 * listener on `.title-dim-select`, `fillSelect`) keeps working unchanged — and
 * this module renders a button + popup with a filter box on top of it. Picking an
 * entry writes `sel.value` and dispatches a bubbling `change`, i.e. exactly what
 * the native control did.
 */

import { getL10n } from './l10n';

const L = getL10n();

interface ComboRefs {
  wrap: HTMLElement;
  btn: HTMLButtonElement;
  pop: HTMLElement;
  filter: HTMLInputElement;
  list: HTMLElement;
  /** Called on open so callers can lazy-fetch the full element list. */
  onOpen?: () => void;
  /** Index of the active row WITHIN the rendered window, -1 when nothing shown. */
  active: number;
  /** Options matching the current filter — cached so sliding the render window
   *  by one row does not rescan a 100k-option `<select>` per arrow key. */
  opts: HTMLOptionElement[];
  /** Index into `opts` of the first rendered row. */
  winStart: number;
  /** Show and match the option LABEL instead of its value (views, subsets:
   *  their values carry `pub:`/`priv:` prefixes). */
  byLabel: boolean;
}

export interface ComboOptions {
  /** Filter box placeholder; default "Filter elements…". */
  placeholder?: string;
  /** See `ComboRefs.byLabel`. Also keeps the button in step with every
   *  programmatic change of the select (see `_watchSelect`). */
  byLabel?: boolean;
}

/** Visible text of an option: the label (tree indent stripped) or the value. */
function _text(o: HTMLOptionElement, refs: ComboRefs): string {
  return refs.byLabel ? (o.textContent ?? '').trim() : o.value;
}

const _combos = new WeakMap<HTMLSelectElement, ComboRefs>();
let _openSel: HTMLSelectElement | null = null;
let _globalWired = false;

function _syncButton(sel: HTMLSelectElement, refs: ComboRefs): void {
  // The option text carries the tree indent — the collapsed button shows the
  // bare element name.
  const o = sel.selectedOptions[0];
  const value = (o ? _text(o, refs) : sel.value || '').trim();
  refs.btn.textContent = value || L.selectPlaceholder;
  refs.btn.title = value;
  refs.btn.disabled = sel.disabled;
}

/**
 * Max rows materialised at once. A context dim routinely holds 100k+ elements
 * and the filter box starts empty on every open, so rendering the whole option
 * list would build 100k divs and block the webview for seconds. Render a window
 * of this size and let the filter narrow it — the footer says so.
 */
const RENDER_CAP = 200;

/** The rendered option rows (excludes the empty / “more” affordance rows). */
function _items(refs: ComboRefs): HTMLElement[] {
  return Array.from(refs.list.querySelectorAll<HTMLElement>('.title-combo-item'));
}

/** Rebuild the popup list from the select's options, filtered by the query and
 *  capped at RENDER_CAP rows. `anchor` (index into the FILTERED options) is the
 *  row the window should be built around — omitted it anchors on the current
 *  selection. Rows carry `data-value`; the click handler is delegated to the
 *  list (one listener, not one per row). */
function _renderList(sel: HTMLSelectElement, refs: ComboRefs, anchor?: number): void {
  const q = refs.filter.value.trim().toLowerCase();
  refs.list.textContent = '';
  // A hidden option is out of the choice, as in a native select.
  const opts = Array.from(sel.options).filter(
    (o) => !o.hidden && (!q || _text(o, refs).toLowerCase().indexOf(q) >= 0),
  );
  refs.opts = opts;
  if (opts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'title-combo-empty';
    empty.textContent = L.noMatches;
    refs.list.appendChild(empty);
    refs.active = -1;
    refs.winStart = 0;
    return;
  }
  const current = sel.value;
  // Window the list around the anchor so the selected member stays visible even
  // when it sits far past the cap — and so the members BEFORE it stay reachable
  // with ArrowUp. Anchoring the window AT the selection (the old `start =
  // curIdx`) made everything above index 99 999 unreachable without typing.
  const curIdx = opts.findIndex((o) => o.value === current);
  const anchorIdx = Math.min(opts.length - 1, Math.max(0, anchor ?? (curIdx >= 0 ? curIdx : 0)));
  const start = Math.max(
    0, Math.min(anchorIdx - Math.floor(RENDER_CAP / 2), opts.length - RENDER_CAP),
  );
  refs.winStart = start;
  const shown = opts.slice(start, start + RENDER_CAP);
  let activeIdx = anchorIdx - start;
  if (activeIdx < 0 || activeIdx >= shown.length) {
    activeIdx = shown.findIndex((o) => o.value === current);
    if (activeIdx < 0) { activeIdx = 0; }
  }
  const frag = document.createDocumentFragment();
  let group: Element | null = null;
  shown.forEach((o, i) => {
    // Public/private headings of an <optgroup> select — shown only above the
    // rows that survive the filter, and not rows themselves (the keys skip them).
    const g = o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement : null;
    if (g && g !== group) {
      const head = document.createElement('div');
      head.className = 'title-combo-group';
      head.textContent = (g as HTMLOptGroupElement).label;
      frag.appendChild(head);
    }
    group = g;
    const item = document.createElement('div');
    item.className = 'title-combo-item';
    if (o.value === current) { item.classList.add('is-current'); }
    if (i === activeIdx) { item.classList.add('is-active'); }
    // Keep the option's tree indent, but as padding so a filtered (flat) result
    // list still lines up.
    const text = o.textContent ?? '';
    const indent = text.length - text.replace(/^\s+/, '').length;
    if (indent > 0) { item.style.paddingLeft = `${6 + indent * 4}px`; }
    item.textContent = _text(o, refs);
    item.dataset.value = o.value;
    frag.appendChild(item);
  });
  refs.list.appendChild(frag);
  if (shown.length < opts.length) {
    const more = document.createElement('div');
    more.className = 'title-combo-more';
    // A RANGE, not a count: "200 / 100000" read like "the first 200" even when
    // the window sat at index 99 900. No new l10n key — digits plus the
    // (already localized) filter hint.
    more.textContent = `${start + 1}–${start + shown.length} / ${opts.length} · ${L.filterElements}`;
    refs.list.appendChild(more);
  }
  refs.active = activeIdx;
  _scrollActiveIntoView(refs);
}

function _scrollActiveIntoView(refs: ComboRefs): void {
  const el = _items(refs)[refs.active] as HTMLElement | undefined;
  if (!el) { return; }
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < refs.list.scrollTop) { refs.list.scrollTop = top; }
  else if (bottom > refs.list.scrollTop + refs.list.clientHeight) {
    refs.list.scrollTop = bottom - refs.list.clientHeight;
  }
}

/** Move the active row by `delta`. When the move leaves the rendered window the
 *  window SLIDES (re-render anchored on the new index) instead of clamping at
 *  its edge — otherwise the arrow keys could never leave the initial 200 rows. */
function _moveActive(sel: HTMLSelectElement, refs: ComboRefs, delta: number): void {
  const items = _items(refs);
  if (items.length === 0 || refs.opts.length === 0) { return; }
  const globalIdx = refs.winStart + Math.max(0, refs.active);
  const nextGlobal = Math.min(refs.opts.length - 1, Math.max(0, globalIdx + delta));
  if (nextGlobal === globalIdx) { return; }
  if (nextGlobal < refs.winStart || nextGlobal >= refs.winStart + items.length) {
    _renderList(sel, refs, nextGlobal);
    return;
  }
  items[refs.active]?.classList.remove('is-active');
  refs.active = nextGlobal - refs.winStart;
  items[refs.active].classList.add('is-active');
  _scrollActiveIntoView(refs);
}

function _commit(sel: HTMLSelectElement, value: string): void {
  closeTitleCombo();
  if (sel.value === value) { return; }
  const refs = _combos.get(sel);
  // The option set can be swapped between render and click (lazy element fetch,
  // dim filter). Assigning a value a <select> no longer offers silently resets
  // it to '' — and a `change` on '' would slice the cube on an empty member.
  if (!Array.from(sel.options).some((o) => o.value === value)) {
    if (refs) { _syncButton(sel, refs); }
    return;
  }
  sel.value = value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  if (refs) { _syncButton(sel, refs); }
}

export function closeTitleCombo(): void {
  if (!_openSel) { return; }
  const refs = _combos.get(_openSel);
  _openSel = null;
  window.removeEventListener('resize', closeTitleCombo);
  window.removeEventListener('scroll', _onScroll, true);
  if (!refs) { return; }
  refs.pop.remove();
  refs.wrap.classList.remove('is-open');
}

/**
 * Close on scroll — but NOT when the popup's own list is what scrolled. The
 * capture-phase listener sees every scroll in the document, and setting
 * `list.scrollTop` (active-item tracking) fires one asynchronously, which would
 * shut the popup right after it opened.
 */
function _onScroll(e: Event): void {
  const t = e.target as Node | null;
  const refs = _openSel ? _combos.get(_openSel) : undefined;
  if (refs && t && refs.pop.contains(t)) { return; }
  closeTitleCombo();
}

/** Place the (body-mounted, fixed) popup under its button, flipping up and
 *  clamping horizontally when the viewport edge is in the way. */
function _position(refs: ComboRefs): void {
  const r = refs.btn.getBoundingClientRect();
  const popH = refs.pop.offsetHeight || 320;
  const popW = refs.pop.offsetWidth || 240;
  const below = window.innerHeight - r.bottom;
  refs.pop.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - popW - 8))}px`;
  if (below < popH + 8 && r.top > below) {
    refs.pop.style.top = '';
    refs.pop.style.bottom = `${window.innerHeight - r.top + 2}px`;
  } else {
    refs.pop.style.bottom = '';
    refs.pop.style.top = `${r.bottom + 2}px`;
  }
}

function _open(sel: HTMLSelectElement, refs: ComboRefs): void {
  if (sel.disabled) { return; }
  closeTitleCombo();
  _openSel = sel;
  // The popup lives in <body>, not inside the chip: .title-chip-group clips its
  // children (overflow: hidden), which would leave only the filter box visible.
  document.body.appendChild(refs.pop);
  refs.wrap.classList.add('is-open');
  refs.filter.value = '';
  refs.onOpen?.();
  _renderList(sel, refs);
  _position(refs);
  // preventScroll: focusing must not scroll an ancestor — that scroll would be
  // seen as "user scrolled away" and close the popup immediately.
  refs.filter.focus({ preventScroll: true });
  // A fixed-position popup would drift away from its button on scroll/resize.
  // Register a frame later so scroll events queued by opening (focus, scrollTop)
  // cannot close what just opened.
  requestAnimationFrame(() => {
    if (_openSel !== sel) { return; }
    window.addEventListener('resize', closeTitleCombo);
    window.addEventListener('scroll', _onScroll, true);
  });
}

function _wireGlobal(): void {
  if (_globalWired) { return; }
  _globalWired = true;
  document.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement | null;
    // The popup is body-mounted, so it is NOT inside .title-combo — check both.
    if (t && t.closest && t.closest('.title-combo, .title-combo-pop')) { return; }
    closeTitleCombo();
  }, true);
}

/**
 * Re-sync the button whenever the select changes behind the combo's back: the
 * view and subset pickers rebuild their options with `innerHTML` and set
 * `value`/`selectedIndex` from half a dozen places. One watch here instead of a
 * sync call at each of them — the title zone calls `syncTitleCombo` itself.
 */
function _watchSelect(sel: HTMLSelectElement): void {
  new MutationObserver(() => syncTitleCombo(sel))
    .observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  for (const prop of ['value', 'selectedIndex'] as const) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    if (!d?.get || !d.set) { continue; }
    const { get, set } = d;
    Object.defineProperty(sel, prop, {
      configurable: true,
      get() { return get.call(this); },
      set(v: unknown) { set.call(this, v); syncTitleCombo(sel); },
    });
  }
}

/**
 * Wrap `sel` in a searchable combo. Returns the wrapper to append in place of
 * the select; the select is moved inside it (hidden by CSS) and stays the single
 * source of truth for the current context element.
 */
export function attachTitleCombo(
  sel: HTMLSelectElement, dim: string, onOpen?: () => void, opts: ComboOptions = {},
): HTMLElement {
  _wireGlobal();

  const wrap = document.createElement('span');
  wrap.className = 'title-combo';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'title-combo-btn';
  // Right-click on the context control must still open the dim context menu,
  // which resolves the dim from `data-dim-name` (the select is hidden now).
  if (dim) {
    btn.dataset.dimName = dim;
    btn.dataset.dim = dim;
  }

  // Not appended here — _open() mounts it in <body> so the chip's overflow:hidden
  // cannot clip it.
  const pop = document.createElement('div');
  pop.className = 'title-combo-pop';

  const filter = document.createElement('input');
  filter.type = 'text';
  filter.className = 'title-combo-filter';
  filter.placeholder = opts.placeholder ?? L.filterElements;
  filter.spellcheck = false;

  const list = document.createElement('div');
  list.className = 'title-combo-list';

  pop.appendChild(filter);
  pop.appendChild(list);

  const refs: ComboRefs = { wrap, btn, pop, filter, list, onOpen, active: -1, opts: [], winStart: 0, byLabel: !!opts.byLabel };
  _combos.set(sel, refs);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_openSel === sel) { closeTitleCombo(); } else { _open(sel, refs); }
  });

  // ONE delegated listener for the whole list — a per-row listener would mean
  // one closure per element on a 100k-member context dim (M13).
  list.addEventListener('mousedown', (e) => {
    const item = (e.target as HTMLElement | null)?.closest<HTMLElement>('.title-combo-item');
    const value = item?.dataset.value;
    if (value === undefined) { return; }
    e.preventDefault(); // keep focus in the filter box until we commit
    _commit(sel, value);
  });

  // Tab (or any other focus move out of the popup) must close it: the popup is
  // body-mounted, so it would otherwise float on detached from focus until the
  // next outside mousedown / scroll / resize.
  pop.addEventListener('focusout', (e) => {
    const next = (e as FocusEvent).relatedTarget as Node | null;
    // relatedTarget === null = focus went nowhere focusable (window blur,
    // click on a non-focusable area) — the mousedown handler covers those.
    if (!next || pop.contains(next) || next === btn) { return; }
    if (_openSel === sel) { closeTitleCombo(); }
  });

  filter.addEventListener('input', () => _renderList(sel, refs));
  filter.addEventListener('keydown', (e: KeyboardEvent) => {
    // The grid installs document-level key handlers — keep them out of the box.
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); _moveActive(sel, refs, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _moveActive(sel, refs, -1); }
    else if (e.key === 'PageDown') { e.preventDefault(); _moveActive(sel, refs, 10); }
    else if (e.key === 'PageUp') { e.preventDefault(); _moveActive(sel, refs, -10); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const el = _items(refs)[refs.active] as HTMLElement | undefined;
      if (el?.dataset.value !== undefined) { _commit(sel, el.dataset.value); }
    } else if (e.key === 'Escape') { e.preventDefault(); closeTitleCombo(); btn.focus(); }
    // Let Tab move focus on (no preventDefault) but take the popup with it.
    // Closing DURING keydown removes the focused filter box before the browser
    // runs the default Tab action, so focus falls back to <body> instead of the
    // next control — defer past it.
    else if (e.key === 'Tab') { setTimeout(closeTitleCombo, 0); }
  });

  wrap.appendChild(btn);
  wrap.appendChild(sel);
  _syncButton(sel, refs);
  if (opts.byLabel) { _watchSelect(sel); }
  return wrap;
}

/**
 * `attachTitleCombo` where the select stands. The combo moves the select into
 * its wrapper, so the spot must be taken first — `sel.after(attachTitleCombo(sel))`
 * inserts the wrapper next to its own child and throws HierarchyRequestError.
 */
export function mountTitleCombo(sel: HTMLSelectElement, opts: ComboOptions = { byLabel: true }): void {
  const parent = sel.parentNode;
  if (!parent) { return; }
  const spot = sel.nextSibling;
  parent.insertBefore(attachTitleCombo(sel, '', undefined, opts), spot);
}

/**
 * Re-sync a combo after its select's options changed (lazy element fetch, dim
 * filter). Updates the collapsed label and, while open, the visible list.
 */
export function syncTitleCombo(sel: HTMLSelectElement): void {
  const refs = _combos.get(sel);
  if (!refs) { return; }
  _syncButton(sel, refs);
  if (_openSel === sel) {
    _renderList(sel, refs);
    // The popup was placed while it was a one-row box; it just grew to the full
    // 280px list. Without re-positioning, a combo near the bottom edge stays
    // anchored downward and hangs off the viewport (position: fixed → nothing
    // scrolls it back into view).
    _position(refs);
  }
}
