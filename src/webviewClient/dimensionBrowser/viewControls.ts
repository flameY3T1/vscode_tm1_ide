export {};

import { markCount } from './viewMarks';
import type { FilterLayer } from './filterPredicate';
import { getL10n, fmt } from '../_shared/l10n';
// An attribute name is server data, not markup — it is escaped with the ONE
// version from `pure.ts`, not with a fourth hand copy.
import { esc } from './pure';
import { COL_INDEX, COL_WEIGHT, PSEUDO_COLS } from './attrColumns';

const L = getL10n();

/**
 * What the button row triggers — as callbacks, NOT as imports.
 *
 * `viewControls` needs `setBase`/`applyFilter` from `viewPath`, and `viewPath`
 * needs `initViewControls` — a cycle that `npm run lint:deps` reports as a
 * build breaker. The callbacks invert the dependency.
 */
export interface ViewControlCallbacks {
  setBase: (kind: 'tree' | 'set') => void;
  keepMarked: () => void;
  removeMarked: () => void;
  /**
   * Create a filter layer. ONE callback for all bars: N/C/S, the search and
   * the attribute filter differ in the layer they build, not in what happens
   * afterwards.
   */
  applyLayer: (layer: FilterLayer) => void;
  /**
   * SHOW the typed layer without creating it. `null` withdraws it.
   * Separate from `applyLayer`, because "Apply" remains the conclusion.
   */
  previewLayer: (layer: FilterLayer | null) => void;
  /**
   * The display alias. NOT a layer: it changes what the rows are called, not
   * which ones are there — hence no chip in the trail either. Empty means "Name".
   */
  setAlias: (attr: string) => void;
  /** The sorting. `'none'` removes it. */
  setSort: (mode: 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc' | 'none') => void;
  /** The level layer. `null` removes it — NOT `0`, that is the leaf level. */
  setLevel: (level: number | null) => void;
  /**
   * The display columns. Takes effect when the list is CLOSED, not per
   * checkmark — five columns should trigger one reload, not five.
   */
  setAttrColumns: (names: string[]) => void;
}

/**
 * Show the controls of the new load path and hide those of the old one.
 *
 * Cleanly separated instead of reinterpreted: after this call the UPPER filter
 * bar is exclusively the old path and the LOWER one exclusively the new one.
 * Whoever flips the switch SEES the separation — instead of operating buttons
 * whose meaning has changed behind the scenes.
 */
const OLD_IDS = [
  'btn-show-all', 'btn-keep-marked', 'btn-remove-marked', 'mark-count',
  'quick-only-n', 'quick-only-c', 'quick-only-s',
  // The old search field disappears with the old buttons. Leaving it visible
  // and dead would be wrong twice: it looks operable, and it would stand next
  // to a second field that promises to do the same.
  'filter-input', 'attr-name-filter', 'attr-val-filter', 'attr-name-label',
  'alias-select', 'alias-label', 'sort-mode', 'sort-label', 'level-filter', 'level-label',
  // "Alias" in the context menu: the selection field does it, a second way
  // there would be a second state (decision by flameY3T1, 2026-08-23).
  'ctx-alias',
];
const NEW_IDS = [
  'vw-btn-base-members', 'vw-btn-base-all', 'vw-btn-keep', 'vw-btn-remove',
  'vw-quick-n', 'vw-quick-c', 'vw-quick-s', 'vw-mark-count', 'vw-filter-input',
  'vw-attr-name', 'vw-attr-value', 'vw-attr-label', 'vw-filter-apply', 'vw-attr-apply',
  'vw-alias', 'vw-alias-label', 'vw-sort', 'vw-level', 'vw-attrcols-btn',
];

function el(id: string): HTMLElement | null {
  return document.getElementById(id) as HTMLElement | null;
}

/**
 * Bind with a loud failure instead of `?.`.
 *
 * Important 2 (final review): `el(id)?.addEventListener(...)` turns a
 * misplaced or renamed id into a SILENT no-op — exactly the silent fallback
 * that the guardrails forbid. A missing element is a wiring error (markup and
 * script have drifted apart), not a valid runtime situation — hence
 * `console.warn`, not `if (e)` silence.
 */
function bind(id: string, handler: (e: unknown) => void): void {
  const e = el(id);
  if (!e) {
    console.warn(`[dimbrowser] button ${id} missing from the markup`);
    return;
  }
  e.addEventListener('click', handler);
}

let bound = false;

export function initViewControls(cbs: ViewControlCallbacks): void {
  for (const id of OLD_IDS) { const e = el(id); if (e) { e.style.display = 'none'; } }
  for (const id of NEW_IDS) { const e = el(id); if (e) { e.style.display = ''; } }
  if (bound) { return; }
  bound = true;

  bind('vw-btn-base-members', () => cbs.setBase('tree'));
  bind('vw-btn-base-all', () => cbs.setBase('set'));
  bind('vw-btn-keep', () => cbs.keepMarked());
  bind('vw-btn-remove', () => cbs.removeMarked());
  bind('vw-quick-n', () => cbs.applyLayer({ kind: 'type', types: ['N'] }));
  bind('vw-quick-c', () => cbs.applyLayer({ kind: 'type', types: ['C'] }));
  bind('vw-quick-s', () => cbs.applyLayer({ kind: 'type', types: ['S'] }));
  bindBars(cbs);
  bind('vw-attrcols-btn', () => attrColsToggle(cbs));
  bindAttrColsChoice();
  bindAttrColsOutsideClick(cbs);
}

/**
 * How long the preview waits after the last keystroke.
 *
 * ONE value for both bars — "uniform" here means literally the same pause.
 * 400 ms instead of the earlier 300: the preview of the attribute filter
 * costs ~1.4 s (live 2026-08-23), and a pause that is too short sends off
 * rounds whose answer is already stale before it arrives.
 */
const PREVIEW_PAUSE_MS = 400;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

function stopTimer(): void {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
}

/**
 * Wire up the search bar and the attribute bar — both by the SAME rule.
 *
 * Two separate things, on purpose:
 *
 *   TYPING  → after a thinking pause a PREVIEW. It applies to fetching and
 *             drawing, but is not in the stack — the trail shows it as
 *             pending, without an undo `x`.
 *   APPLY   → the layer moves into the expression, the field becomes empty,
 *             and the next input puts a FURTHER one on top.
 *
 * Thus the empty field is the statement "arrived", without a half-finished
 * input ever leaving an intent in the trail.
 */
function bindBars(cbs: ViewControlCallbacks): void {
  const field = el('vw-filter-input') as HTMLInputElement | null;
  const button = el('vw-filter-apply');
  const aName = el('vw-attr-name') as HTMLSelectElement | null;
  const attrValue = el('vw-attr-value') as HTMLInputElement | null;
  const attrButton = el('vw-attr-apply');
  const alias = el('vw-alias') as HTMLSelectElement | null;
  if (!field || !button || !aName || !attrValue || !attrButton || !alias) {
    console.warn('[dimBrowser] filter bars incomplete in the markup');
    return;
  }

  /** What the search bar currently says — `null` if it says nothing. */
  const searchLayer = (): FilterLayer | null => {
    const t = field.value.trim();
    // An empty pattern is not a layer: `TM1FILTERBYPATTERN(set, "")` matches
    // NOTHING (measured live) — as a preview it would empty the display.
    if (!t) { return null; }
    // The search hits what is VISIBLE: with the alias switched on it searches
    // in it (third argument of `TM1FILTERBYPATTERN`), otherwise in the name.
    //
    // The name comes from the selection field and is therefore necessarily one
    // from `attrDefs`. That is the guard against the measured silent fallback:
    // an attribute that does not exist throws no error, it just keeps
    // searching in the name — a typo would look like a result.
    const a = alias ? alias.value.trim() : '';
    return a ? { kind: 'pattern', pattern: t, attr: a } : { kind: 'pattern', pattern: t };
  };
  /**
   * What the attribute bar says.
   *
   * The VALUE alone suffices: if the selection is on "none", the element name
   * and the ALIAS attributes are searched. Until 2026-10-08 it was every
   * attribute: the cost grows with each one (every element is checked per
   * attribute), and on a 4.6-million-element dimension "none" was far slower
   * than the name search. Whoever needs a string attribute picks it. The list
   * comes from the selection field itself — it is therefore necessarily that
   * of the dimension, and the layer carries it firmly with it.
   *
   * Price, measured live: on 621 occurrences 3 ms, on 1.63 million 2.3 s
   * against 890 ms for a single attribute. That is why it sits behind "Apply".
   */
  const attrLayer = (): FilterLayer | null => {
    const a = aName.value.trim();
    const w = attrValue.value.trim();
    if (!w) { return null; }
    if (a) { return { kind: 'attr', attrs: [a], value: w }; }
    const all: string[] = [];
    for (let i = 0; i < aName.options.length; i++) {
      const o = aName.options[i]!;
      const v = o.value.trim();
      if (v && o.dataset?.type === 'Alias') { all.push(v); }
    }
    return { kind: 'attr', attrs: all, value: w, withName: true };
  };

  const showLater = (what: () => FilterLayer | null): void => {
    stopTimer();
    previewTimer = setTimeout(() => { previewTimer = null; cbs.previewLayer(what()); }, PREVIEW_PAUSE_MS);
  };
  const showNow = (what: () => FilterLayer | null): void => {
    stopTimer();
    cbs.previewLayer(what());
  };
  const apply = (what: () => FilterLayer | null, after: () => void): void => {
    const l = what();
    if (!l) { return; }
    stopTimer();
    after();
    // First withdraw the preview, then create: otherwise the same layer would
    // stand twice in the expression for a moment.
    cbs.previewLayer(null);
    cbs.applyLayer(l);
  };

  field.addEventListener('input', () => showLater(searchLayer));
  button.addEventListener('click', () => apply(searchLayer, () => { field.value = ''; }));
  field.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(searchLayer, () => { field.value = ''; }); return; }
    // Escape is the quick way back: field empty AND preview gone. Emptying only
    // the field would leave a display standing that nobody explains anymore.
    if (e.key === 'Escape') { e.preventDefault(); field.value = ''; showNow(searchLayer); }
  });

  // A change in the selection field shows IMMEDIATELY — a selection is a
  // single act, there is nothing to type and therefore nothing to wait for.
  aName.addEventListener('change', () => showNow(attrLayer));
  attrValue.addEventListener('input', () => showLater(attrLayer));
  // Only the VALUE is emptied: whoever searched in an attribute will probably
  // search in it again right away.
  attrButton.addEventListener('click', () => apply(attrLayer, () => { attrValue.value = ''; }));
  attrValue.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(attrLayer, () => { attrValue.value = ''; }); return; }
    if (e.key === 'Escape') { e.preventDefault(); attrValue.value = ''; showNow(attrLayer); }
  });

  // Immediately, without a pause: a selection is a single act. And without a
  // preview, because the alias is not a layer — it changes the labeling of the
  // rows, not their selection.
  alias.addEventListener('change', () => cbs.setAlias(alias.value.trim()));

  // Sorting and level likewise: selection fields take effect immediately. An
  // "Apply" next to them would be a button for a decision that was already
  // made when the mouse was released (decision by flameY3T1, 2026-08-23).
  //
  // Both are a MENU, not a state display (decision by flameY3T1, 2026-08-23:
  // "Sort on it, then you select something, then it is applied and stands on
  // Sort again"). After the choice they jump back to their label. The state
  // stands in the TRAIL — there it can also be undone. A field that showed the
  // state would be a second truth next to it: it knows only its own intent,
  // not the others in the stack.
  const SORT_VALUES: readonly string[] =
    ['hierarchy', 'hier-asc', 'hier-desc', 'asc', 'desc', 'index-asc', 'index-desc'];
  const sortEl = el('vw-sort') as HTMLSelectElement | null;
  if (sortEl) {
    sortEl.addEventListener('change', () => {
      const v = sortEl.value;
      sortEl.value = '';
      if (!v) { return; }
      cbs.setSort(SORT_VALUES.indexOf(v) >= 0
        ? (v as 'hierarchy' | 'hier-asc' | 'hier-desc' | 'asc' | 'desc' | 'index-asc' | 'index-desc') : 'none');
    });
  } else { console.warn('[dimBrowser] sort field vw-sort missing from the markup'); }

  const levelEl = el('vw-level') as HTMLSelectElement | null;
  if (levelEl) {
    levelEl.addEventListener('change', () => {
      // `'-'` is the explicit entry "no level". The EMPTY label must not be
      // it: the field jumps back to that after every choice.
      const raw = levelEl.value.trim();
      levelEl.value = '';
      if (raw === '') { return; }
      cbs.setLevel(raw === '-' ? null : Number(raw));
    });
  } else { console.warn('[dimBrowser] level field vw-level missing from the markup'); }
}

/**
 * Fill the selection list from the attribute definitions of the dimension.
 *
 * The empty first value is the resting position, not an attribute named "" —
 * without it, an attribute that nobody chose would be selected on opening.
 */
function fill(
  id: string, defs: readonly { Name: string; Type?: string }[], emptyLabel: string,
): void {
  const sel = el(id) as HTMLSelectElement | null;
  if (!sel) { return; }
  const previous = sel.value;
  // data-type: the attribute search on "none" reads it (aliases only).
  sel.innerHTML = `<option value="">${esc(emptyLabel)}</option>`
    + defs.map((d) => `<option value="${esc(d.Name)}" data-type="${esc(d.Type ?? '')}">${esc(d.Name)}</option>`).join('');
  // A selection already made survives the refill if it still exists —
  // otherwise a reload would clear away the user's intent.
  if (previous && defs.some((d) => d.Name === previous)) { sel.value = previous; }
}

/**
 * The checkbox list. Not a `<select multiple>`: that renders as a list box
 * instead of as a dropdown and does not fit into a toolbar.
 *
 * ALL attributes, not only the alias types — unlike `vw-alias`, where a
 * numeric attribute as an element label would be a mix-up.
 */
export function attrColPickerHtml(
  defs: readonly { Name: string; Type?: string }[], chosen: readonly string[],
): string {
  const checked = new Set(chosen);
  // `tag` marks alias attributes: the list holds all types, and an alias reads
  // differently (an alternative element name) from a plain string attribute.
  const row = (value: string, text: string, tag = ''): string =>
    '<label class="vw-attrcol-item"><input type="checkbox" value="' + esc(value) + '"'
    + (checked.has(value) ? ' checked' : '') + '>' + esc(text)
    + (tag ? '<span class="vw-attrcol-tag">' + esc(tag) + '</span>' : '') + '</label>';
  // Index and weight are ALWAYS there, even on a dimension without any
  // attributes — they hang on the element and not on an attribute definition.
  // Hence no `!defs.length` early exit before them anymore: the list would
  // otherwise be empty exactly where it would have the only thing to offer.
  const fixed = row(COL_INDEX, attrColLabel(COL_INDEX))
    + row(COL_WEIGHT, attrColLabel(COL_WEIGHT))
    + '<div class="vw-attrcol-sep" role="separator"></div>';
  if (!defs.length) {
    return fixed + '<div class="vw-attrcol-empty">' + esc(L.vwAttrColsNone ?? '') + '</div>';
  }
  return fixed + defs.map((d) => row(d.Name, d.Name, d.Type === 'Alias' ? (L.vwAttrAliasTag ?? 'Alias') : '')).join('');
}

/**
 * The label of a column — for the checkbox list AND the header row.
 *
 * The two placeholders internally carry a NUL name that tells nobody anything;
 * a real attribute is called what it is called. One place for both, so that
 * list and header row cannot drift apart.
 */
export function attrColLabel(name: string): string {
  if (name === COL_INDEX) { return L.vwColIndex ?? 'Index'; }
  if (name === COL_WEIGHT) { return L.vwColWeight ?? 'Weight'; }
  return name;
}

/** Definitions of the current dimension — basis of the checkbox list. */
let _attrDefsForColumns: readonly { Name: string; Type?: string }[] = [];
/** For which dimension the definitions apply — see `trimAttrColumns`. */
let _attrDefsDim: string | undefined;
/** Are there any definitions yet at all? Otherwise empty would mean two things. */
let _attrDefsDa = false;
/**
 * The selection as it CAME IN — uncut.
 *
 * Two sources, both without knowledge of the definitions: the remembered state
 * from the host (`showAttrColumnSelection`) and the own checking. The
 * intersection with the definitions only happens in `trimAttrColumns`, and
 * as often as one of the two sides reports in — so the uncut version must be
 * kept, otherwise an intersection against a still-missing list would be final.
 */
let _attrColumnsRaw: string[] = [];
/** For which dimension `_attrColumnsRaw` applies. */
let _attrColumnsDim: string | undefined;
/**
 * What APPLIES: the selection in selection order, intersected with the
 * definitions. Preset of the checkmarks AND basis of the button label.
 */
let _attrColumnsChosen: string[] = [];
/** Open/closed state of the checkbox list. */
let _attrColsMenuOpen = false;

/** Deduplicated, empty names are dropped — the same rule as `attrColumns.ts`. */
function cleanOrder(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!n || seen.has(n)) { continue; }
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Intersect the state with the definitions — one rule, ONE place.
 *
 * Intersection happens only if the definitions belong to the same dimension as
 * the state. Otherwise not: on a dimension switch the remembered state of the
 * NEW dimension meets the definitions of the OLD one, and an intersection
 * against them would delete valid columns. This makes the order of the two
 * messages irrelevant — each of the two recomputes, neither relies on having
 * come last.
 */
function trimAttrColumns(): void {
  if (!_attrDefsDa || _attrDefsDim !== _attrColumnsDim) {
    _attrColumnsChosen = _attrColumnsRaw.slice();
    return;
  }
  const known = new Set(_attrDefsForColumns.map((d) => d.Name));
  // The placeholders are in NO attribute definition — without the exception
  // this filter would cut them away again on every `attrDefs` answer.
  for (const p of PSEUDO_COLS) { known.add(p); }
  _attrColumnsChosen = _attrColumnsRaw.filter((n) => known.has(n));
}

function attrColsLabel(): string {
  return _attrColumnsChosen.length
    ? fmt(L, 'vwAttrColsButtonN', _attrColumnsChosen.length)
    : (L.vwAttrColsButton ?? '');
}

/** Update the button label — even if the list is currently closed. */
function attrColsRenderButton(): void {
  const btn = el('vw-attrcols-btn');
  if (btn) { btn.textContent = attrColsLabel(); }
}

function attrColsOpen(): void {
  _attrColsMenuOpen = true;
  const menu = el('vw-attrcols-menu');
  const btn = el('vw-attrcols-btn');
  if (menu) {
    menu.style.display = '';
    menu.innerHTML = attrColPickerHtml(_attrDefsForColumns, _attrColumnsChosen);
  }
  if (btn) { btn.setAttribute('aria-expanded', 'true'); }
}

/**
 * A checkmark was toggled — update the record.
 *
 * The selection order originates HERE (fix round 2, finding 2), not when
 * collecting: the DOM is in DEFINITION order, and whoever checks "Jahr" first
 * and "NAME" second would otherwise get `['NAME','Jahr']`. Newly checked
 * means appended at the end, unchecked means removed, the others keep their
 * place.
 */
function noteAttrColumn(name: string, checked: boolean): void {
  if (!name) { return; }
  const i = _attrColumnsChosen.indexOf(name);
  if (checked) {
    if (i < 0) { _attrColumnsChosen.push(name); }
  } else if (i >= 0) {
    _attrColumnsChosen.splice(i, 1);
  }
  // The record applies to the dimension from whose definitions the list was
  // built — otherwise a later `showAttrDefs` would cut it away.
  _attrColumnsDim = _attrDefsDim;
  _attrColumnsRaw = _attrColumnsChosen.slice();
}

/**
 * Bring the checked names into SELECTION order.
 *
 * Two sources, on purpose: the DOM says WHICH columns are on — that remains
 * the truth, even if a `change` once did not arrive. The record says in which
 * ORDER they were chosen. A name that the record does not know is appended at
 * the end (in DOM order) instead of disappearing.
 */
function orderByChoice(ticked: readonly string[]): string[] {
  const checked = new Set(ticked);
  const known = _attrColumnsChosen.filter((n) => checked.has(n));
  const added = ticked.filter((n) => _attrColumnsChosen.indexOf(n) < 0);
  return known.concat(added);
}

/**
 * Closing collects the checkmarks and reports them ONCE — not on every single
 * click on a checkbox (spec: five columns, one reload).
 */
function attrColsClose(cbs: ViewControlCallbacks): void {
  if (!_attrColsMenuOpen) { return; }
  const menu = el('vw-attrcols-menu');
  const btn = el('vw-attrcols-btn');
  const ticked: string[] = [];
  if (menu) {
    menu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      const input = cb as HTMLInputElement;
      if (input.checked) { ticked.push(input.value); }
    });
    menu.style.display = 'none';
  }
  if (btn) { btn.setAttribute('aria-expanded', 'false'); }
  _attrColsMenuOpen = false;
  const names = orderByChoice(ticked);
  _attrColumnsChosen = names;
  _attrColumnsRaw = names.slice();
  _attrColumnsDim = _attrDefsDim;
  attrColsRenderButton();
  cbs.setAttrColumns(names);
}

function attrColsToggle(cbs: ViewControlCallbacks): void {
  if (_attrColsMenuOpen) { attrColsClose(cbs); } else { attrColsOpen(); }
}

let _attrColsChoiceBound = false;

/**
 * Listen in on the checking — delegated on the MENU, not on the checkboxes:
 * those are rebuilt on every opening (`innerHTML`), a binding on them would be
 * gone after the next opening. The menu itself remains the same node.
 *
 * As with `bind()`: no silent `?.`, but a LOUD notice. Without the binding
 * only the selection ORDER falls back to the definition order
 * (`orderByChoice` appends unknown names at the end) — the selection itself
 * keeps coming from the DOM.
 */
function bindAttrColsChoice(): void {
  if (_attrColsChoiceBound) { return; }
  const menu = el('vw-attrcols-menu');
  if (!menu || typeof menu.addEventListener !== 'function') {
    console.warn('[dimbrowser] vw-attrcols-menu missing — the selection order of the attribute columns is not recorded');
    return;
  }
  _attrColsChoiceBound = true;
  menu.addEventListener('change', (e: Event) => {
    // No `type === 'checkbox'` test: nothing else is in the menu, and the two
    // fields that are needed are the better evidence.
    const target = e.target as { value?: unknown; checked?: unknown } | null;
    if (!target || typeof target.value !== 'string' || typeof target.checked !== 'boolean') { return; }
    noteAttrColumn(target.value, target.checked);
  });
}

let _attrColsOutsideClickBound = false;

/**
 * A click outside menu and button closes the list — like an ordinary
 * dropdown. The button itself is excluded, otherwise this outside click would
 * close the list BEFORE its own `click` handler, which would then immediately
 * open it again (the toggle would get stuck).
 */
function bindAttrColsOutsideClick(cbs: ViewControlCallbacks): void {
  if (_attrColsOutsideClickBound) { return; }
  // Many tests of this load path set `document` to a slim object with only
  // `getElementById` (no real jsdom) — `startView` calls `initViewControls` in
  // each of these tests. As with `bind()` above: no silent `?.` silence, but a
  // LOUD notice via `console.warn` — the binding is then actually missing, and
  // a test that wants to check the outside click has to bring a fuller
  // `document` double (see `dimBrowserAttrColMenu.test.ts`). Real webviews
  // always have a full `document`.
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
    console.warn('[dimbrowser] document.addEventListener missing — outside-click closer of the attribute column list not bound');
    return;
  }
  _attrColsOutsideClickBound = true;
  document.addEventListener('mousedown', (e) => {
    if (!_attrColsMenuOpen) { return; }
    const menu = el('vw-attrcols-menu');
    const btn = el('vw-attrcols-btn');
    const target = e.target as Node | null;
    if (menu && target && menu.contains(target)) { return; }
    if (btn && target && btn.contains(target)) { return; }
    attrColsClose(cbs);
  });
}

/**
 * Fill both selection lists from the attribute definitions.
 *
 * Two different sets, on purpose: the FILTER can search any attribute, but the
 * DISPLAY can only show what is maintained as an alias. A numeric attribute as
 * an element label would not be a display, but a mix-up.
 */
/** The alias reported last as effective — see `showActiveAlias`. */
let _activeAlias = '';

export function showAttrDefs(
  defs: readonly { Name: string; Type?: string }[], dimName?: string,
): void {
  fill('vw-attr-name', defs, L.optNone ?? '');
  fill('vw-alias', defs.filter((d) => d.Type === 'Alias'), L.optName ?? '');
  // The EFFECTIVE alias wins over the field value: if it comes from the caller
  // (jump from the Cube Viewer), it was never in the field, and `fill` can
  // only hold it if it was already in. A field that shows "Name" while the rows
  // stand under an alias is a false statement.
  const sel = el('vw-alias') as HTMLSelectElement | null;
  if (sel && _activeAlias && defs.some((d) => d.Name === _activeAlias)) {
    sel.value = _activeAlias;
  }
  // The third list from the same definitions — ALL attributes (see
  // `attrColPickerHtml`). The button carries its label even before the first
  // opening; if the list is currently open, its content follows as well.
  _attrDefsForColumns = defs;
  _attrDefsDim = dimName;
  _attrDefsDa = true;
  // Only now can the remembered state be intersected: an attribute name that
  // the hierarchy no longer knows must not produce a ghost column.
  trimAttrColumns();
  attrColsRenderButton();
  if (_attrColsMenuOpen) {
    const menu = el('vw-attrcols-menu');
    if (menu) { menu.innerHTML = attrColPickerHtml(_attrDefsForColumns, _attrColumnsChosen); }
  }
}

/**
 * Which alias is currently EFFECTIVE — reported by `viewPath`, not decided
 * here.
 *
 * Only one direction: `viewPath` imports `viewControls`, the reverse would be
 * a cycle (see the head of this file). That is why the path reports its state
 * here, instead of the field fetching it.
 */
export function showActiveAlias(alias: string): void {
  _activeAlias = alias;
  // Setting it directly suffices: if the field does not (yet) know the option,
  // a `<select>` falls back to the empty entry by itself — and as soon as
  // `showAttrDefs` delivers the aliases, it picks up the value from there.
  const sel = el('vw-alias') as HTMLSelectElement | null;
  if (sel) { sel.value = alias; }
}

/**
 * Which columns were REMEMBERED — reported by the message path, not decided
 * here. The same pattern as `showActiveAlias` one function above.
 *
 * Fix round 2, finding 1: until then only the renderer
 * (`attrColumns.ts`) knew the remembered state. The checkbox list had its own,
 * always empty one — the button said "Attributes" instead of "Attributes (3)",
 * no checkbox was checked, and opening and closing WITHOUT a change collected
 * `[]` and thereby deleted the stored entry.
 *
 * `dimName` belongs here, not just as decoration: it decides whether the
 * present definitions fit this state at all (see `trimAttrColumns`).
 */
export function showAttrColumnSelection(names: readonly string[], dimName?: string): void {
  _attrColumnsRaw = cleanOrder(names);
  _attrColumnsDim = dimName;
  trimAttrColumns();
  attrColsRenderButton();
  // If the list is currently open, it follows as well — otherwise it would
  // show checkmarks that no longer apply.
  if (_attrColsMenuOpen) {
    const menu = el('vw-attrcols-menu');
    if (menu) { menu.innerHTML = attrColPickerHtml(_attrDefsForColumns, _attrColumnsChosen); }
  }
}

/**
 * What applies after the intersection — for the renderer, which updates its
 * columns accordingly (`viewPath.ts#onAttrDefs`). A copy.
 */
export function attrColSelection(): string[] {
  return _attrColumnsChosen.slice();
}

/**
 * Fill the level selection field — only with levels that EXIST.
 *
 * `TM1FILTERBYLEVEL` on a higher level silently returns 0 rows live instead of
 * an error; an offered empty level would be a dead end without explanation.
 */
export function showLevels(levels: readonly { Number: number; Name?: string }[]): void {
  const sel = el('vw-level') as HTMLSelectElement | null;
  if (!sel) { return; }
  sel.innerHTML = `<option value="">${esc(L.vwLevelMenu ?? '')}</option>`
    + `<option value="-">${esc(L.vwLevelAny ?? '')}</option>`
    + levels.map((l) => `<option value="${l.Number}">${esc(fmt(L, 'levelOption', l.Number))}</option>`).join('');
  // No restoring of the previous choice: the field is a menu and always stands
  // on its label.
  sel.value = '';
}

/**
 * Keep and Remove need a mark. Without one both would be pointless —
 * `INTERSECT(x, {}, ALL)` is empty, `EXCEPT(x, {}, ALL)` is `x`.
 */
export function syncViewControls(): void {
  const off = markCount() === 0;
  const keep = el('vw-btn-keep') as HTMLButtonElement | null;
  const rem = el('vw-btn-remove') as HTMLButtonElement | null;
  if (keep) { keep.disabled = off; }
  if (rem) { rem.disabled = off; }
}

/** For tests only. */
export function _resetViewControlsForTest(): void {
  bound = false; _activeAlias = ''; stopTimer();
  _attrDefsForColumns = []; _attrColumnsChosen = []; _attrColsMenuOpen = false;
  _attrDefsDim = undefined; _attrDefsDa = false;
  _attrColumnsRaw = []; _attrColumnsDim = undefined; _attrColsChoiceBound = false;
  // The same "bind once" pattern as `clickBound` above, the same reset
  // (fix round 1, minor): otherwise a second test in the same file never binds
  // the NEW `document` double from its own `bauDom()`, because the flag from
  // the first test is still set.
  _attrColsOutsideClickBound = false;
}
