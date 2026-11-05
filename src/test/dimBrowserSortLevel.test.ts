import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwTrailSortHier: 'tree order', vwTrailSortAsc: 'A–Z {0}', vwTrailSortDesc: 'Z–A {0}',
    vwTrailLevel: 'Level {0}', vwBaseMembers: 'Tree',
    // Deliberately contains special characters: the label of the level field must
    // end up escaped in the markup (see the test "escapes the labels of the level field").
    vwLevelMenu: '<Ebene>',
  };
});
vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { initialView, pushIntent, orderIsReplaced } from '../webviewClient/dimensionBrowser/intents';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import { trailHtml } from '../webviewClient/dimensionBrowser/viewTrail';

const mit = (i: Parameters<typeof pushIntent>[1]) => pushIntent(initialView('tree'), i);

/**
 * Sorting is the first intent that REORDERS instead of taking something away.
 *
 * Measured live (2026-08-23, `Stations`, 621 occurrences): `TM1SORT ASC/DESC`,
 * `HIERARCHIZE` and `ORDER(..., Properties(attr), BASC/BDESC)` all return 621
 * — they take nothing away. They only reorder.
 *
 * It follows the same rule as the search: it orders what is VISIBLE. With the
 * alias switched on it therefore sorts by the alias (`ORDER`), otherwise by the
 * name (`TM1SORT`).
 */
describe('sorting as an intent', () => {
  it('sorts FLAT with BASC/BDESC', () => {
    // Not `TM1SORT`, even though it yields the same order (measured identical
    // character by character on all 621 rows of `Stations`, both directions).
    // The menu names the directions by their MDX names — an entry `BASC` that
    // writes `TM1SORT` would be a label that does not mean the expression next
    // to it.
    expect(storedMdx(mit({ kind: 'sort', mode: 'asc' }), 'aa', 'aa'))
      .toBe('{ORDER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Name, BASC)}');
    expect(storedMdx(mit({ kind: 'sort', mode: 'desc' }), 'aa', 'aa'))
      .toContain(', BDESC)');
  });

  it('sorts by INDEX with TM1SORTBYINDEX', () => {
    // Measured live (2026-08-23, `aa` and `Stations`): `ASC` on
    // `TM1SUBSETALL` is exactly the index order character by character, `DESC`
    // exactly the reverse, and on `.Members` all occurrences are kept (621 -> 621).
    //
    // The detour via `ORDER(..., Properties("ELEMENT_INDEX"), ...)` would be
    // wrong: it sorts LEXICOGRAPHICALLY (index 10 before index 2) and is only
    // correct for up to nine elements. A `* 1` meant to make it numeric makes
    // `ORDER` SILENTLY return the input unchanged.
    expect(storedMdx(mit({ kind: 'sort', mode: 'index-asc' }), 'aa', 'aa'))
      .toBe('{TM1SORTBYINDEX({[aa].[aa].Members}, ASC)}');
    expect(storedMdx(mit({ kind: 'sort', mode: 'index-desc' }), 'aa', 'aa'))
      .toBe('{TM1SORTBYINDEX({[aa].[aa].Members}, DESC)}');
  });

  it('the index ignores an alias — it is not a label', () => {
    expect(storedMdx(mit({ kind: 'sort', mode: 'index-asc', attr: 'SITENAME' }), 'aa', 'aa'))
      .toBe('{TM1SORTBYINDEX({[aa].[aa].Members}, ASC)}');
  });

  it('index order is not tree order — flat', () => {
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'index-asc' }))).toBe(true);
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'index-desc' }))).toBe(true);
  });

  it('sorts HIERARCHY-PRESERVING with ORDER ASC/DESC', () => {
    // Measured live on `aa` (2026-08-23): `ORDER(..., ASC)` returns
    // `d a b c x | sum a | xxx x xx` — parents sorted, children sorted beneath
    // them, tree preserved. `BASC` on the other hand returns `a a b c d sum x x xx xxx`,
    // i.e. flat. The indentation depends on exactly that.
    expect(storedMdx(mit({ kind: 'sort', mode: 'hier-asc' }), 'aa', 'aa'))
      .toBe('{ORDER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Name, ASC)}');
    expect(storedMdx(mit({ kind: 'sort', mode: 'hier-desc' }), 'aa', 'aa'))
      .toContain(', DESC)');
  });

  it('hierarchy-preserving by the alias when one is displayed', () => {
    expect(storedMdx(mit({ kind: 'sort', mode: 'hier-asc', attr: 'SITENAME' }), 'aa', 'aa'))
      .toBe('{ORDER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("SITENAME"), ASC)}');
  });

  it('sorts by the display alias with ORDER — TM1SORT cannot do that', () => {
    expect(storedMdx(mit({ kind: 'sort', mode: 'asc', attr: 'SITENAME' }), 'aa', 'aa'))
      .toBe('{ORDER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("SITENAME"), BASC)}');
    expect(storedMdx(mit({ kind: 'sort', mode: 'desc', attr: 'SITENAME' }), 'aa', 'aa'))
      .toContain('BDESC');
  });

  it('tree order is HIERARCHIZE and ignores an alias', () => {
    // The alias says nothing about the position in the tree — writing it in
    // here would be a sort that does not exist.
    expect(storedMdx(mit({ kind: 'sort', mode: 'hierarchy', attr: 'SITENAME' }), 'aa', 'aa'))
      .toBe('{HIERARCHIZE({[aa].[aa].Members})}');
  });

  it('only the FLAT sorts replace the order', () => {
    // The INDENTATION depends on this. Measured live: `ORDER(..., ASC)` keeps
    // children under their parents, `TM1SORT`/`BASC` tears them out.
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'asc' }))).toBe(true);
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'desc' }))).toBe(true);
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'hierarchy' }))).toBe(false);
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'hier-asc' }))).toBe(false);
    expect(orderIsReplaced(mit({ kind: 'sort', mode: 'hier-desc' }))).toBe(false);
  });

  it('the trail names it, and names what it sorts by', () => {
    const html = trailHtml(mit({ kind: 'sort', mode: 'asc', attr: 'SITENAME' }));
    expect(html).toContain('SITENAME');
    expect(trailHtml(mit({ kind: 'sort', mode: 'hierarchy' }))).toContain('tree order');
  });

  it('escapes the attribute name as a string literal (" doubled, ] kept)', () => {
    expect(storedMdx(mit({ kind: 'sort', mode: 'asc', attr: 'a]b"c' }), 'aa', 'aa'))
      .toContain('"a]b""c"');
  });
});

// ---------------------------------------------------------------------------

import {
  startView, setLevel, onLevels, currentMdx, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import {
  initViewControls, showLevels, _resetViewControlsForTest,
} from '../webviewClient/dimensionBrowser/viewControls';
import { setSort } from '../webviewClient/dimensionBrowser/viewActions';

type Stub = {
  value: string; innerHTML: string; style: Record<string, string>; disabled: boolean;
  classList: { toggle(c: string, an?: boolean): void };
  setAttribute(n: string, v: string): void;
  _h: Record<string, (e: unknown) => void>;
  addEventListener(t: string, h: (e: unknown) => void): void;
};

const IDS = ['btn-show-all', 'btn-keep-marked', 'btn-remove-marked', 'mark-count',
  'quick-only-n', 'quick-only-c', 'quick-only-s', 'filter-input',
  'attr-name-filter', 'attr-val-filter', 'attr-name-label', 'alias-select', 'alias-label',
  'level-filter', 'level-label', 'sort-mode', 'sort-label',
  'vw-btn-base-members', 'vw-btn-base-all', 'vw-btn-keep', 'vw-btn-remove',
  'vw-quick-n', 'vw-quick-c', 'vw-quick-s', 'vw-mark-count',
  'vw-filter-input', 'vw-filter-apply',
  'vw-attr-name', 'vw-attr-value', 'vw-attr-label', 'vw-attr-apply',
  'vw-alias', 'vw-alias-label', 'vw-sort', 'vw-level'];

function bauDom(): Record<string, Stub> {
  const els: Record<string, Stub> = {};
  for (const id of IDS) {
    els[id] = {
      value: '', innerHTML: '', style: { display: '' }, disabled: false, _h: {},
      classList: { toggle: () => {} }, setAttribute: () => {},
      addEventListener(t, h) { this._h[t] = h; },
    };
  }
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    // Task 6: the checkbox list binds an outside-click closer to the
    // document — the stub is enough for these tests, they do not check it.
    addEventListener: () => {},
  };
  return els;
}

describe('sort and level are select fields, not forms', () => {
  let sortiert: string[];
  let ebenen: (number | null)[];
  const stummel = () => ({
    setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
    applyLayer: () => {}, previewLayer: () => {}, setAlias: () => {},
    setSort: (m: string) => { sortiert.push(m); },
    setLevel: (n: number | null) => { ebenen.push(n); },
    setAttrColumns: () => {},
  });

  beforeEach(() => { sortiert = []; ebenen = []; _resetViewControlsForTest(); });

  it('take effect IMMEDIATELY — a selection is a single act, there is nothing to confirm', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-sort'].value = 'asc';
    els['vw-sort']._h.change!({});
    els['vw-level'].value = '2';
    els['vw-level']._h.change!({});
    expect(sortiert).toEqual(['asc']);
    expect(ebenen).toEqual([2]);
  });

  it('jump back to their label afterwards — they are a MENU', () => {
    // Decision by flameY3T1, 2026-08-23: "Sort da drauf, dann waehlt man was aus,
    // dann wird das applied und steht wieder auf Sort." (Sort on it, then you pick
    // something, then it gets applied and shows Sort again.)
    //
    // So the field shows the ACTION, not the state. The state is shown in the
    // trail — and can be undone there as well. A field that showed the state
    // would be a second truth next to it: it only knows its own intent, not the
    // others on the stack.
    const els = bauDom();
    initViewControls(stummel());
    els['vw-sort'].value = 'asc';
    els['vw-sort']._h.change!({});
    expect(els['vw-sort'].value).toBe('');
    els['vw-level'].value = '2';
    els['vw-level']._h.change!({});
    expect(els['vw-level'].value).toBe('');
  });

  it('the entry "all" removes the level — the empty label does not', () => {
    // Two different things, ever since the field became a menu: `''` is the
    // label it jumps back to after EVERY choice — reacting to it cleared the
    // level that had just been set right away again. `'-'` is the explicit
    // choice "all".
    //
    // And `null` means NO level, not level 0: `TM1FILTERBYLEVEL(set, 0)`
    // is the leaf level and a real filter.
    const els = bauDom();
    initViewControls(stummel());
    els['vw-level'].value = '';
    els['vw-level']._h.change!({});
    expect(ebenen).toEqual([]);
    els['vw-level'].value = '-';
    els['vw-level']._h.change!({});
    expect(ebenen).toEqual([null]);
  });

  it('offers only levels that exist', () => {
    // `TM1FILTERBYLEVEL(set, 9)` live SILENTLY returns 0 rows instead of an
    // error — offering a level that is empty would be a dead end.
    const els = bauDom();
    initViewControls(stummel());
    showLevels([{ Number: 0, Name: 'level000' }, { Number: 1, Name: 'level001' }]);
    expect(els['vw-level'].innerHTML).toContain('value="0"');
    expect(els['vw-level'].innerHTML).toContain('value="1"');
    expect(els['vw-level'].innerHTML).not.toContain('value="2"');
  });

  it('escapes the labels of the level field', () => {
    // `showLevels` builds its markup from bundle texts. These also go through
    // the same single escaping routine as the attribute names — otherwise a
    // translation string containing `<` would have broken the select field.
    const els = bauDom();
    initViewControls(stummel());
    showLevels([{ Number: 0, Name: 'level000' }]);
    expect(els['vw-level'].innerHTML).toContain('&lt;Ebene&gt;');
    expect(els['vw-level'].innerHTML).not.toContain('<Ebene>');
  });

  it('hides the old fields together with their labels', () => {
    const els = bauDom();
    initViewControls(stummel());
    for (const id of ['sort-mode', 'sort-label', 'level-filter', 'level-label']) {
      expect(els[id].style.display, id).toBe('none');
    }
    expect(els['vw-sort'].style.display).toBe('');
    expect(els['vw-level'].style.display).toBe('');
  });
});

describe('sort and level on the load path', () => {
  let posted: { type: string; mdx?: string }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };
  const zeilen = () => posted.filter((p) => p.type === 'fetchViewRows');

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetViewControlsForTest();
    bauDom();
  });

  it('asks for the levels on start', () => {
    startView('aa', 'aa', post);
    expect(posted.filter((p) => p.type === 'fetchLevels')).toHaveLength(1);
  });

  it('accepts the level list only for THIS dimension', () => {
    const els = bauDom();
    initViewControls({
      setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
      applyLayer: () => {}, previewLayer: () => {}, setAlias: () => {},
      setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
    });
    startView('aa', 'aa', post);
    onLevels({ type: 'levels', dimName: 'bb', hierName: 'bb', levels: [{ Number: 7 }] } as never);
    expect(els['vw-level'].innerHTML).not.toContain('value="7"');
  });

  it('replaces an existing sort instead of stacking a second one', () => {
    // Two sorts on top of each other are not two intents: the lower one has
    // no effect, but would still be shown as a chip that could be undone on
    // its own — an undo that changes nothing.
    startView('aa', 'aa', post);
    setSort('asc');
    setSort('desc');
    const letzter = currentMdx()!;
    expect(letzter.match(/ORDER\(/g)).toHaveLength(1);
    expect(letzter).toContain('BDESC');
  });

  it('"none" removes the sort', () => {
    startView('aa', 'aa', post);
    setSort('asc');
    setSort('none');
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('the level ACCUMULATES — each choice adds one, choosing the same one removes it', () => {
    // Decision by flameY3T1, 2026-08-23: several levels at once. The field is
    // a menu and cannot show the state, so toggling is the only interaction
    // that allows this without a state display.
    startView('aa', 'aa', post);
    setLevel(0);
    setLevel(1);
    // One call with both arguments — `TM1FILTERBYLEVEL` is variadic.
    expect(currentMdx()).toContain('TM1FILTERBYLEVEL({[aa].[aa].Members}, 0, 1)');
    setLevel(0);
    expect(currentMdx()).toContain('TM1FILTERBYLEVEL({[aa].[aa].Members}, 1)');
    setLevel(null);
    expect(currentMdx()).toBe('{[aa].[aa].Members}');
  });

  it('the same choice twice does NOT fetch twice', () => {
    startView('aa', 'aa', post);
    setSort('asc');
    const n = zeilen().length;
    setSort('asc');
    expect(zeilen()).toHaveLength(n);
  });
});
