import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  initViewControls, showAttrDefs, _resetViewControlsForTest,
} from '../webviewClient/dimensionBrowser/viewControls';
import {
  startView, setAlias, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { parseSetAnswer } from '../tm1Rest/dimensionSetQueryPure';
import type { FilterLayer } from '../webviewClient/dimensionBrowser/filterPredicate';

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
  'sort-mode', 'sort-label', 'level-filter', 'level-label', 'vw-sort', 'vw-level',
  'vw-btn-base-members', 'vw-btn-base-all', 'vw-btn-keep', 'vw-btn-remove',
  'vw-quick-n', 'vw-quick-c', 'vw-quick-s', 'vw-mark-count',
  'vw-filter-input', 'vw-filter-apply',
  'vw-attr-name', 'vw-attr-value', 'vw-attr-label', 'vw-attr-apply',
  'vw-alias', 'vw-alias-label'];

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

const DEFS = [{ Name: 'SITENAME', Type: 'Alias' }, { Name: 'SITE+Name', Type: 'Alias' },
  { Name: 'Kommentar', Type: 'String' }];

describe('The display alias', () => {
  let schichten: (FilterLayer | null)[];
  let aliasse: string[];
  const stummel = () => ({
    setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
    applyLayer: (l: FilterLayer) => { schichten.push(l); },
    previewLayer: (l: FilterLayer | null) => { schichten.push(l); },
    setAlias: (a: string) => { aliasse.push(a); },
    setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
  });

  beforeEach(() => { schichten = []; aliasse = []; _resetViewControlsForTest(); });

  it('offers ONLY alias attributes, not every attribute', () => {
    // The attribute list next to it shows all of them — there you filter by values.
    // But only what is maintained as an alias can be displayed.
    const els = bauDom();
    initViewControls(stummel());
    showAttrDefs(DEFS);
    expect(els['vw-alias'].innerHTML).toContain('value="SITENAME"');
    expect(els['vw-alias'].innerHTML).toContain('value="SITE+Name"');
    expect(els['vw-alias'].innerHTML).not.toContain('Kommentar');
    expect(els['vw-attr-name'].innerHTML).toContain('Kommentar');
  });

  it('hides the old display selection', () => {
    const els = bauDom();
    initViewControls(stummel());
    expect(els['alias-select'].style.display).toBe('none');
    expect(els['alias-label'].style.display).toBe('none');
    expect(els['vw-alias'].style.display).toBe('');
  });

  it('reports the choice immediately — it changes the display, not the set', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-alias'].value = 'SITENAME';
    els['vw-alias']._h.change!({});
    expect(aliasse).toEqual(['SITENAME']);
  });

  it('the search carries the enabled alias along', () => {
    const els = bauDom();
    initViewControls(stummel());
    showAttrDefs(DEFS);
    els['vw-alias'].value = 'SITENAME';
    els['vw-filter-input'].value = 'burg*';
    els['vw-filter-apply']._h.click!({});
    expect(schichten.filter(Boolean))
      .toContainEqual({ kind: 'pattern', pattern: 'burg*', attr: 'SITENAME' });
  });

  it('without an alias the search stays with the name', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'burg*';
    els['vw-filter-apply']._h.click!({});
    expect(schichten.filter(Boolean)).toContainEqual({ kind: 'pattern', pattern: 'burg*' });
  });
});

describe('The alias travels to the row query', () => {
  let posted: { type: string; alias?: string }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };
  const zeilen = () => posted.filter((p) => p.type === 'fetchViewRows');

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetViewControlsForTest();
    bauDom();
  });

  it('fetches again when the alias changes — the caption comes from the server', () => {
    startView('aa', 'aa', post);
    const n = zeilen().length;
    setAlias('SITENAME');
    expect(zeilen()).toHaveLength(n + 1);
    expect(zeilen().at(-1)!.alias).toBe('SITENAME');
  });

  it('takes the caller\'s alias along already for the FIRST query', () => {
    // Jump from the Cube Viewer: the view shows the dimension under
    // an alias (live `Reporting/APS`: `Stations -> SITENAME`). Without
    // passing it through, the browser opened on raw element names, while the
    // grid next to it showed the alias (click test 2026-08-23) — and setting it
    // afterwards cost a whole window query for nothing.
    startView('aa', 'aa', post, undefined, undefined, 'SITENAME');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].alias).toBe('SITENAME');
  });

  it('the passed alias also stands in the selection field', () => {
    startView('aa', 'aa', post, undefined, undefined, 'SITENAME');
    showAttrDefs([{ Name: 'SITENAME', Type: 'Alias' }, { Name: 'Andere', Type: 'Alias' }]);
    expect((document.getElementById('vw-alias') as HTMLSelectElement).value).toBe('SITENAME');
  });

  it('the same alias twice does NOT fetch twice', () => {
    startView('aa', 'aa', post);
    setAlias('SITENAME');
    const n = zeilen().length;
    setAlias('SITENAME');
    expect(zeilen()).toHaveLength(n);
  });
});

describe('The row is called what the alias says', () => {
  const antwort = {
    Tuples: [{ Members: [{ Name: 'SITE2021_100001_C', DisplayInfo: 0,
      Attributes: { Caption: 'SITE2021_100001_C', SITENAME: 'Site 2021 North Depot' } }] }],
  };

  it('takes the chosen alias as the caption', () => {
    expect(parseSetAnswer(antwort, 'SITENAME')[0].caption).toBe('Site 2021 North Depot');
  });

  it('without an alias it stays with Caption', () => {
    expect(parseSetAnswer(antwort)[0].caption).toBe('SITE2021_100001_C');
  });

  it('an empty alias value falls back to the NAME, not to emptiness', () => {
    // Live 11.8: TM1 does not deliver the alias value when it equals the
    // name. An empty row would be the result — the row would have no text.

    const leer = { Tuples: [{ Members: [{ Name: 'a', Attributes: { Caption: 'a' } }] }] };
    expect(parseSetAnswer(leer, 'SITENAME')[0].caption).toBe('a');
  });
});
