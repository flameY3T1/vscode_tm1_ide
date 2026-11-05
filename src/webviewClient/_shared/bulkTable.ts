// src/webviewClient/_shared/bulkTable.ts
//
// What the two bulk pages (deletion and migration) have in common.
//
// Until 2026-09-20 this was copied into both bundles: 178 of the 333
// non-trivial lines of the migration page also appeared verbatim in the
// deletion page — kind filter, pattern matching, header checkbox, "All/None",
// Enter search, expand arrow, the first four cells of every row and the
// structure of the detail row.
//
// What does NOT happen here: inverting the pages. Each keeps its own state and
// its own `render()`. What lives here are building blocks that the pages call
// — not a framework layer that calls back. The difference matters, because
// `tsc -p ./` does NOT check `webviewClient/`: whatever is wired up wrongly
// here only shows up when you click.
import { fmt, type L10nMap } from './l10n';

/** The least that a row of both pages has. */
export interface BulkRowBase {
  kind: string;
  name: string;
  parent?: string;
  hierarchy?: string;
  /** Control object — the filter hides it as long as the checkbox is unchecked. */
  isControl?: boolean;
}

/** The two text functions that every page needs. */
export interface BulkText {
  t(key: string, ...args: string[]): string;
  kindLabel(kind: string): string;
}

/**
 * Text access to a map that arrives ONLY LATER.
 *
 * The map arrives with `init`, but the page builds its functions on load.
 * Hence access goes through a function and not a fixed binding.
 */
export function bulkText(read: () => L10nMap): BulkText {
  return {
    t: (key, ...args) => fmt(read(), key, ...args),
    kindLabel: (kind) => fmt(read(), 'kind' + kind.charAt(0).toUpperCase() + kind.slice(1)),
  };
}

/** The checked kind checkboxes of the header row. */
export function activeKinds(): Set<string> {
  const out = new Set<string>();
  for (const el of Array.from(document.querySelectorAll('.bd-kind-box'))) {
    const box = el as HTMLInputElement;
    if (box.checked) { out.add(box.dataset.kind as string); }
  }
  return out;
}

/**
 * The first four cells of every row: checkbox, expand arrow, kind, name.
 *
 * The status columns behind them are attached by the page itself — that is
 * where the two differ. The checkbox is returned because the row click toggles
 * it and the page then sets its classes.
 */
export interface RowShellDeps {
  selected: Set<string>;
  expanded: Set<string>;
  /** Called after every state change — the page redraws. */
  rerender: () => void;
  text: BulkText;
  matchesPattern: (name: string, pattern: string) => boolean;
  rowKey: (r: BulkRowBase) => string;
  rowOwner: (r: BulkRowBase) => string;
}

export function buildRowShell(
  r: BulkRowBase,
  deps: RowShellDeps,
  /** Whether the row has something to expand. */
  expandable: boolean,
): { tr: HTMLTableRowElement; box: HTMLInputElement; key: string; open: boolean } {
  const tr = document.createElement('tr');
  const key = deps.rowKey(r);

  const tdBox = document.createElement('td');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = deps.selected.has(key);
  box.addEventListener('change', () => {
    if (box.checked) { deps.selected.add(key); } else { deps.selected.delete(key); }
    // Redraw, not just count: on both pages the selection changes the
    // finding of the other rows.
    deps.rerender();
  });
  tdBox.appendChild(box);
  tr.appendChild(tdBox);

  const open = deps.expanded.has(key);
  const tdExp = document.createElement('td');
  if (expandable) {
    tdExp.className = 'bd-exp';
    tdExp.textContent = open ? '▾' : '▸';
    tdExp.title = deps.text.t('expandTitle');
    tdExp.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (open) { deps.expanded.delete(key); } else { deps.expanded.add(key); }
      deps.rerender();
    });
  }
  tr.appendChild(tdExp);

  const tdKind = document.createElement('td');
  tdKind.className = 'bd-kind';
  tdKind.textContent = deps.text.kindLabel(r.kind);
  tr.appendChild(tdKind);

  const tdName = document.createElement('td');
  const ownerText = deps.rowOwner(r);
  if (ownerText) {
    // The cube or dimension in front (for subsets also the hierarchy),
    // dimmed: `Default` alone does not say which one is meant.
    const owner = document.createElement('span');
    owner.className = 'bd-owner';
    owner.textContent = `${ownerText} / `;
    tdName.appendChild(owner);
  }
  tdName.appendChild(document.createTextNode(r.name));
  tr.appendChild(tdName);

  return { tr, box, key, open };
}

/** The row click checks the box — the checkbox alone is a small target. */
export function wireRowClick(tr: HTMLTableRowElement, box: HTMLInputElement): void {
  tr.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'INPUT') { return; }
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
  });
}

/**
 * The scaffold of the expanded row: two empty cells, then one cell across the
 * rest. `colSpan` is the number of columns BEHIND them — the two pages have
 * different numbers.
 */
export function buildDetailShell(colSpan: number): {
  tr: HTMLTableRowElement; td: HTMLTableCellElement;
} {
  const tr = document.createElement('tr');
  tr.className = 'bd-detail';
  tr.appendChild(document.createElement('td'));
  tr.appendChild(document.createElement('td'));
  const td = document.createElement('td');
  td.colSpan = colSpan;
  tr.appendChild(td);
  return { tr, td };
}

/** One category row in it: label on the left, names on the right. */
export function appendDetailLine(td: HTMLElement, label: string, value: string): void {
  const div = document.createElement('div');
  div.className = 'bd-dline';
  const lab = document.createElement('span');
  lab.className = 'bd-dlabel';
  lab.textContent = label;
  const val = document.createElement('span');
  val.textContent = value;
  div.appendChild(lab);
  div.appendChild(val);
  td.appendChild(div);
}

/**
 * The wiring that is the same on both pages: kind checkboxes, pattern field
 * including Enter, control object checkbox, header checkbox, "All/None" and the
 * search button.
 *
 * Everything that comes after — target choice, check button, delete or
 * transfer button — stays with the page.
 */
export interface BulkWiring {
  selected: Set<string>;
  rerender: () => void;
  /** The currently visible rows; "All" and the header checkbox apply to them. */
  visibleRows: () => readonly BulkRowBase[];
  rowKey: (r: BulkRowBase) => string;
  runSearch: () => void;
  headBox: HTMLInputElement;
  patternInput: HTMLInputElement;
  controlBox: HTMLInputElement;
  searchBtn: HTMLButtonElement;
  /** Hint "choose a kind first" — visible as long as none is chosen. */
  searchHint: HTMLElement;
  allBtn: HTMLElement;
  noneBtn: HTMLElement;
}

export function wireBulkTable(w: BulkWiring): { syncSearchState: () => void } {
  const syncSearchState = (): void => {
    const none = activeKinds().size === 0;
    w.searchBtn.disabled = none;
    w.searchHint.hidden = !none;
  };

  for (const el of Array.from(document.querySelectorAll('.bd-kind-box'))) {
    el.addEventListener('change', () => { syncSearchState(); w.rerender(); });
  }
  w.patternInput.addEventListener('input', w.rerender);
  w.patternInput.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') { w.runSearch(); }
  });
  w.controlBox.addEventListener('change', w.rerender);
  w.headBox.addEventListener('change', () => {
    const list = w.visibleRows();
    for (const r of list) {
      if (w.headBox.checked) { w.selected.add(w.rowKey(r)); } else { w.selected.delete(w.rowKey(r)); }
    }
    w.rerender();
  });
  w.allBtn.addEventListener('click', () => {
    for (const r of w.visibleRows()) { w.selected.add(w.rowKey(r)); }
    w.rerender();
  });
  w.noneBtn.addEventListener('click', () => { w.selected.clear(); w.rerender(); });
  w.searchBtn.addEventListener('click', w.runSearch);

  return { syncSearchState };
}

/**
 * The state of the header checkbox: checked if EVERY visible row is checked.
 * An empty table counts as not checked.
 */
export function headBoxChecked(
  visible: readonly BulkRowBase[],
  selected: ReadonlySet<string>,
  rowKey: (r: BulkRowBase) => string,
): boolean {
  return visible.length > 0 && visible.every(r => selected.has(rowKey(r)));
}
