// src/test/bulkTableShared.test.ts
//
// The shared building blocks of the two bulk pages
// (`webviewClient/_shared/bulkTable.ts`).
//
// Why they need a test of their own: `tsc -p ./` excludes
// `src/webviewClient/`, and the two pages have no
// bundle guard. Anything wired wrongly here would otherwise only show up when
// clicking — and since 2026-09-20 BOTH pages hang on it, so a bug
// here hits two surfaces at once.
//
// The DOM is rebuilt, not loaded: the building blocks only touch
// `createElement`, `querySelectorAll` and a handful of properties.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  activeKinds, appendDetailLine, buildDetailShell, buildRowShell, bulkText,
  headBoxChecked, wireBulkTable, type BulkRowBase,
} from '../webviewClient/_shared/bulkTable';

// ── Minimal DOM ───────────────────────────────────────────────────────────

class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  className = '';
  textContent = '';
  title = '';
  type = '';
  checked = false;
  disabled = false;
  hidden = false;
  value = '';
  colSpan = 0;
  dataset: Record<string, string> = {};

  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c; }
  addEventListener(t: string, fn: (ev: unknown) => void): void {
    (this.listeners[t] ??= []).push(fn);
  }
  dispatchEvent(ev: { type: string }): void { this.fire(ev.type); }
  fire(t: string, ev: unknown = { target: this }): void {
    for (const fn of this.listeners[t] ?? []) { fn(ev); }
  }
  /** The text of the cell including children — `textContent` alone is not good enough for that. */
  get deepText(): string {
    return this.textContent + this.children.map(c => c.deepText).join('');
  }
}

let kindBoxes: FakeEl[] = [];

beforeEach(() => {
  kindBoxes = [];
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new FakeEl(tag),
    // A text node here is an element with text — `deepText` reads both.
    createTextNode: (text: string) => {
      const n = new FakeEl('#text');
      n.textContent = text;
      return n;
    },
    querySelectorAll: (sel: string) => (sel === '.bd-kind-box' ? kindBoxes : []),
  };
  (globalThis as unknown as { Event: unknown }).Event = class {
    type: string;
    constructor(t: string) { this.type = t; }
  };
});

function kindBox(kind: string, checked: boolean): FakeEl {
  const el = new FakeEl('input');
  el.type = 'checkbox';
  el.dataset.kind = kind;
  el.checked = checked;
  kindBoxes.push(el);
  return el;
}

const ROWS: BulkRowBase[] = [
  { kind: 'cube', name: 'Sales' },
  { kind: 'view', name: 'Default', parent: 'Sales' },
];
const key = (r: BulkRowBase): string => `${r.kind}|${r.parent ?? ''}|${r.name}`;
/** The building blocks return real DOM types; in the test they are `FakeEl`. */
const fake = (el: unknown): FakeEl => el as unknown as FakeEl;
const owner = (r: BulkRowBase): string => r.parent ?? '';

// ── Text ────────────────────────────────────────────────────────────────────

describe('bulkText', () => {
  it('reads the map only ON the call', () => {
    // The map arrives with `init`, but the page builds its functions
    // on load. A fixed binding would stay empty forever.
    let map: Record<string, string> = {};
    const { t } = bulkText(() => map);
    expect(t('counts', '3', '1')).toBe('counts');
    map = { counts: '{0} gezeigt, {1} gewählt' };
    expect(t('counts', '3', '1')).toBe('3 gezeigt, 1 gewählt');
  });

  it('builds the kind label from the key', () => {
    const { kindLabel } = bulkText(() => ({ kindCube: 'Würfel', kindSubset: 'Teilmenge' }));
    expect(kindLabel('cube')).toBe('Würfel');
    expect(kindLabel('subset')).toBe('Teilmenge');
  });
});

// ── Kind filter ─────────────────────────────────────────────────────────────

describe('activeKinds', () => {
  it('takes only the checked boxes', () => {
    kindBox('cube', true);
    kindBox('view', false);
    kindBox('process', true);
    expect([...activeKinds()].sort()).toEqual(['cube', 'process']);
  });

  it('without boxes the set is empty', () => {
    expect(activeKinds().size).toBe(0);
  });
});

// ── Header checkbox ───────────────────────────────────────────────────────────

describe('headBoxChecked', () => {
  it('is checked when EVERY visible row is checked', () => {
    const sel = new Set(ROWS.map(key));
    expect(headBoxChecked(ROWS, sel, key)).toBe(true);
  });

  it('one unchecked row is enough for no', () => {
    expect(headBoxChecked(ROWS, new Set([key(ROWS[0])]), key)).toBe(false);
  });

  it('the empty table is NOT checked', () => {
    // Otherwise the checkmark would be there before the first search.
    expect(headBoxChecked([], new Set(), key)).toBe(false);
  });
});

// ── Row skeleton ────────────────────────────────────────────────────────────

describe('buildRowShell', () => {
  function deps(selected: Set<string>, expanded: Set<string>, rerender = vi.fn()) {
    return {
      selected, expanded, rerender,
      text: bulkText(() => ({ kindCube: 'Cube', expandTitle: 'Namen zeigen' })),
      matchesPattern: () => true,
      rowKey: key,
      rowOwner: owner,
    };
  }

  it('builds four cells: checkbox, arrow, kind, name', () => {
    const { tr } = buildRowShell(ROWS[0], deps(new Set(), new Set()), false);
    expect(fake(tr).children).toHaveLength(4);
    expect(fake(tr).children[2].textContent).toBe('Cube');
    expect(fake(tr).children[3].deepText).toBe('Sales');
  });

  it('puts the parent object in front when there is one', () => {
    const { tr } = buildRowShell(ROWS[1], deps(new Set(), new Set()), false);
    expect(fake(tr).children[3].deepText).toBe('Sales / Default');
  });

  it('draws the arrow only when there is something to expand', () => {
    const ohne = buildRowShell(ROWS[0], deps(new Set(), new Set()), false);
    expect(fake(ohne.tr).children[1].textContent).toBe('');
    const mit = buildRowShell(ROWS[0], deps(new Set(), new Set()), true);
    expect(fake(mit.tr).children[1].textContent).toBe('▸');
  });

  it('checks and redraws', () => {
    const selected = new Set<string>();
    const rerender = vi.fn();
    const { box } = buildRowShell(ROWS[0], deps(selected, new Set(), rerender), false);
    box.checked = true;
    fake(box).fire('change');
    expect([...selected]).toEqual([key(ROWS[0])]);
    expect(rerender).toHaveBeenCalled();
    box.checked = false;
    fake(box).fire('change');
    expect(selected.size).toBe(0);
  });

  it('the arrow click expands and stops the row click', () => {
    const expanded = new Set<string>();
    const rerender = vi.fn();
    const { tr } = buildRowShell(ROWS[0], deps(new Set(), expanded, rerender), true);
    const stopPropagation = vi.fn();
    fake(tr).children[1].fire('click', { stopPropagation });
    expect([...expanded]).toEqual([key(ROWS[0])]);
    // Without the stop, the same click checks the row.
    expect(stopPropagation).toHaveBeenCalled();
  });
});

// ── Detail row ─────────────────────────────────────────────────────────────

describe('buildDetailShell', () => {
  it('leaves two fields free and spans the rest', () => {
    const { tr, td } = buildDetailShell(8);
    expect(tr.className).toBe('bd-detail');
    expect(fake(tr).children).toHaveLength(3);
    expect(td.colSpan).toBe(8);
  });

  it('takes one row per section', () => {
    const { td } = buildDetailShell(4);
    appendDetailLine(td, 'Prozesse', 'A, B');
    appendDetailLine(td, 'Regeln', 'C');
    expect(fake(td).children).toHaveLength(2);
    expect(fake(td).children[0].deepText).toBe('ProzesseA, B');
  });
});

// ── Wiring ─────────────────────────────────────────────────────────────

describe('wireBulkTable', () => {
  function harness(selected = new Set<string>()) {
    const headBox = new FakeEl('input') as unknown as HTMLInputElement;
    const patternInput = new FakeEl('input') as unknown as HTMLInputElement;
    const controlBox = new FakeEl('input') as unknown as HTMLInputElement;
    const searchBtn = new FakeEl('button') as unknown as HTMLButtonElement;
    const searchHint = new FakeEl('div') as unknown as HTMLElement;
    const allBtn = new FakeEl('button') as unknown as HTMLElement;
    const noneBtn = new FakeEl('button') as unknown as HTMLElement;
    const rerender = vi.fn();
    const runSearch = vi.fn();
    const api = wireBulkTable({
      selected, rerender, visibleRows: () => ROWS, rowKey: key, runSearch,
      headBox, patternInput, controlBox, searchBtn, searchHint, allBtn, noneBtn,
    });
    return {
      api, selected, rerender, runSearch,
      headBox: headBox as unknown as FakeEl,
      patternInput: patternInput as unknown as FakeEl,
      searchBtn: searchBtn as unknown as FakeEl,
      searchHint: searchHint as unknown as FakeEl,
      allBtn: allBtn as unknown as FakeEl,
      noneBtn: noneBtn as unknown as FakeEl,
    };
  }

  it('locks the search as long as no kind is chosen', () => {
    kindBox('cube', false);
    const h = harness();
    h.api.syncSearchState();
    expect(h.searchBtn.disabled).toBe(true);
    expect(h.searchHint.hidden).toBe(false);
  });

  it('releases the search as soon as a kind is chosen', () => {
    const box = kindBox('cube', false);
    const h = harness();
    box.checked = true;
    fake(box).fire('change');
    expect(h.searchBtn.disabled).toBe(false);
    expect(h.searchHint.hidden).toBe(true);
    expect(h.rerender).toHaveBeenCalled();
  });

  it('Enter in the pattern field searches, any other key does not', () => {
    const h = harness();
    h.patternInput.fire('keydown', { key: 'a' });
    expect(h.runSearch).not.toHaveBeenCalled();
    h.patternInput.fire('keydown', { key: 'Enter' });
    expect(h.runSearch).toHaveBeenCalledTimes(1);
  });

  it('the header checkbox selects and clears the VISIBLE rows', () => {
    const h = harness();
    h.headBox.checked = true;
    h.headBox.fire('change');
    expect(h.selected.size).toBe(ROWS.length);
    h.headBox.checked = false;
    h.headBox.fire('change');
    expect(h.selected.size).toBe(0);
  });

  it('"None" clears the WHOLE selection, not only the visible one', () => {
    // The selection survives a filter change; "None" must empty it completely,
    // otherwise invisible rows stay checked.
    const h = harness(new Set(['fremd|;|Zeile']));
    h.allBtn.fire('click');
    expect(h.selected.size).toBe(ROWS.length + 1);
    h.noneBtn.fire('click');
    expect(h.selected.size).toBe(0);
  });

  it('the search button triggers the search', () => {
    const h = harness();
    h.searchBtn.fire('click');
    expect(h.runSearch).toHaveBeenCalledTimes(1);
  });
});
