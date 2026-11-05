import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  initViewControls, showAttrDefs, _resetViewControlsForTest,
} from '../webviewClient/dimensionBrowser/viewControls';
import {
  startView, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import type { FilterLayer } from '../webviewClient/dimensionBrowser/filterPredicate';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

type Stub = {
  value: string; innerHTML: string; style: Record<string, string>; disabled: boolean;
  options: { value: string }[];
  classList: { toggle(c: string, an?: boolean): void };
  setAttribute(n: string, v: string): void;
  _h: Record<string, (e: unknown) => void>;
  addEventListener(t: string, h: (e: unknown) => void): void;
};

const IDS = ['btn-show-all', 'btn-keep-marked', 'btn-remove-marked', 'mark-count',
  'quick-only-n', 'quick-only-c', 'quick-only-s', 'filter-input',
  'attr-name-filter', 'attr-val-filter', 'attr-name-label',
  'vw-btn-base-members', 'vw-btn-base-all', 'vw-btn-keep', 'vw-btn-remove',
  'vw-quick-n', 'vw-quick-c', 'vw-quick-s', 'vw-mark-count',
  'vw-filter-input', 'vw-filter-apply',
  'vw-attr-name', 'vw-attr-value', 'vw-attr-label', 'vw-attr-apply',
  'vw-alias', 'vw-alias-label', 'alias-select', 'alias-label',
  'vw-sort', 'vw-level', 'sort-mode', 'sort-label', 'level-filter', 'level-label'];

function bauDom(): Record<string, Stub> {
  const els: Record<string, Stub> = {};
  for (const id of IDS) {
    els[id] = {
      value: '', innerHTML: '', style: { display: '' }, disabled: false, _h: {},
      // `vw-attr-name` is read as a select field when no attribute
      // is chosen — without options the list stays empty and the search runs only in the
      // name.
      options: [] as { value: string }[],
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

/**
 * Decision flameY3T1, 2026-08-23: the bars get an "Apply".
 *
 * With that, a search is a COMPLETED act — it moves into the expression,
 * the field becomes empty, and the next search lays ANOTHER layer on top of it.
 * That fully replaces the previous construction (debounced typing, swapping a layer in its
 * place): no timer, no writing back into the field, no
 * conflict between an arriving answer and a user who keeps typing.
 *
 * At the same time it removes the price that hurt with the attribute filter: it costs
 * ~1.4 s per round (live 2026-08-23), and debounced typing triggered it on
 * every pause.
 */
describe('apply instead of typing', () => {
  let geschichte: FilterLayer[];
  const stummel = () => ({
    setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
    applyLayer: (l: FilterLayer) => { geschichte.push(l); },
    previewLayer: () => {}, setAlias: () => {}, setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
  });

  beforeEach(() => { geschichte = []; _resetViewControlsForTest(); });

  it('the button applies and empties the search bar', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bahn*';
    els['vw-filter-apply']._h.click!({});
    expect(geschichte).toEqual([{ kind: 'pattern', pattern: 'bahn*' }]);
    expect(els['vw-filter-input'].value).toBe('');
  });

  it('the Enter key does the same as the button', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bahn*';
    els['vw-filter-input']._h.keydown!({ key: 'Enter', preventDefault: () => {} });
    expect(geschichte).toEqual([{ kind: 'pattern', pattern: 'bahn*' }]);
    expect(els['vw-filter-input'].value).toBe('');
  });

  it('typing alone applies NOTHING', () => {
    // The whole point of the button: a half-finished input costs no
    // server round. With the attribute filter that would be ~1.4 s per pause for thought.
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bah';
    els['vw-filter-input']._h.input?.({});
    expect(geschichte).toEqual([]);
  });

  it('an empty field applies nothing and stays empty', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = '   ';
    els['vw-filter-apply']._h.click!({});
    expect(geschichte).toEqual([]);
  });

  it('applying twice lays TWO layers, not one swapped one', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = '*C';
    els['vw-filter-apply']._h.click!({});
    els['vw-filter-input'].value = 'bahn*';
    els['vw-filter-apply']._h.click!({});
    expect(geschichte).toEqual([
      { kind: 'pattern', pattern: '*C' },
      { kind: 'pattern', pattern: 'bahn*' },
    ]);
  });

  it('the attribute bar applies attribute AND value, and empties the value', () => {
    const els = bauDom();
    initViewControls(stummel());
    showAttrDefs([{ Name: 'SITENAME' }]);
    els['vw-attr-name'].value = 'SITENAME';
    els['vw-attr-value'].value = 'bahn';
    els['vw-attr-apply']._h.click!({});
    expect(geschichte).toEqual([{ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' }]);
    expect(els['vw-attr-value'].value).toBe('');
    // The attribute stays: whoever searched for `SITENAME` will
    // probably search in it once more right away.
    expect(els['vw-attr-name'].value).toBe('SITENAME');
  });

  it('an attribute WITHOUT a value applies nothing — a value without an attribute does', () => {
    // Decision flameY3T1, 2026-08-23: if the selection stands on "none", the
    // value should still filter — then over all attributes and the name. An
    // attribute without a value, on the other hand, stays half a question.
    const els = bauDom();
    initViewControls(stummel());
    els['vw-attr-name'].value = 'SITENAME';
    els['vw-attr-apply']._h.click!({});
    expect(geschichte).toEqual([]);

    els['vw-attr-name'].value = '';
    els['vw-attr-value'].value = 'bahn';
    els['vw-attr-apply']._h.click!({});
    expect(geschichte).toEqual([{ kind: 'attr', attrs: [], value: 'bahn', withName: true }]);
  });
});

describe('applying on the load path', () => {
  let posted: { type: string; mdx?: string }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };
  const mdxPosted = () => posted.filter((p) => p.type === 'fetchViewRows').map((p) => p.mdx!);

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetViewControlsForTest();
    bauDom();
  });

  it('two applied searches BOTH stand in the expression', () => {
    startView('aa', 'aa', post);
    applyFilter({ kind: 'pattern', pattern: '*C' });
    applyFilter({ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' });
    const letzter = mdxPosted().at(-1)!;
    expect(letzter).toContain('TM1FILTERBYPATTERN');
    expect(letzter).toContain('Properties("SITENAME")');
  });
});

// ---------------------------------------------------------------------------

describe('typing shows a preview, applying completes', () => {
  let vorschauen: (FilterLayer | null)[];
  let angewandt: FilterLayer[];
  const stummel = () => ({
    setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
    applyLayer: (l: FilterLayer) => { angewandt.push(l); },
    previewLayer: (l: FilterLayer | null) => { vorschauen.push(l); }, setAlias: () => {}, setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
  });

  beforeEach(() => {
    vorschauen = []; angewandt = [];
    _resetViewControlsForTest();
    vi.useFakeTimers();
  });

  it('shows the search only after the pause for thought, and only once', () => {
    const els = bauDom();
    initViewControls(stummel());
    for (const t of ['b', 'ba', 'bah']) { els['vw-filter-input'].value = t; els['vw-filter-input']._h.input!({}); }
    expect(vorschauen).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(vorschauen).toEqual([{ kind: 'pattern', pattern: 'bah' }]);
    expect(angewandt).toEqual([]);
  });

  it('the emptied field withdraws the preview', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bah';
    els['vw-filter-input']._h.input!({});
    vi.advanceTimersByTime(400);
    els['vw-filter-input'].value = '';
    els['vw-filter-input']._h.input!({});
    vi.advanceTimersByTime(400);
    expect(vorschauen.at(-1)).toBeNull();
  });

  it('applying withdraws the preview and lays the layer', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bahn*';
    els['vw-filter-input']._h.input!({});
    vi.advanceTimersByTime(400);
    els['vw-filter-apply']._h.click!({});
    expect(angewandt).toEqual([{ kind: 'pattern', pattern: 'bahn*' }]);
    // No lingering timer that reopens the preview after applying.
    vi.advanceTimersByTime(400);
    expect(vorschauen.at(-1)).toBeNull();
  });

  it('Escape empties the field AND withdraws the preview', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-filter-input'].value = 'bahn';
    els['vw-filter-input']._h.input!({});
    vi.advanceTimersByTime(400);
    els['vw-filter-input']._h.keydown!({ key: 'Escape', preventDefault: () => {} });
    expect(els['vw-filter-input'].value).toBe('');
    expect(vorschauen.at(-1)).toBeNull();
  });

  it('the attribute bar shows the same preview after the same pause', () => {
    // "uniform" here means literally: the same pause, the same rule.
    const els = bauDom();
    initViewControls(stummel());
    els['vw-attr-name'].value = 'SITENAME';
    els['vw-attr-value'].value = 'bahn';
    els['vw-attr-value']._h.input!({});
    expect(vorschauen).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(vorschauen).toEqual([{ kind: 'attr', attrs: ['SITENAME'], value: 'bahn' }]);
  });

  it('an attribute change shows IMMEDIATELY — there is nothing to mistype', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-attr-value'].value = 'bahn';
    els['vw-attr-name'].value = 'KURZ';
    els['vw-attr-name']._h.change!({});
    expect(vorschauen).toEqual([{ kind: 'attr', attrs: ['KURZ'], value: 'bahn' }]);
  });

  it('a value without an attribute shows the search over everything', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-attr-value'].value = 'bahn';
    els['vw-attr-value']._h.input!({});
    vi.advanceTimersByTime(400);
    expect(vorschauen).toEqual([{ kind: 'attr', attrs: [], value: 'bahn', withName: true }]);
  });

  it('an empty value field still shows NOTHING', () => {
    const els = bauDom();
    initViewControls(stummel());
    els['vw-attr-name'].value = 'SITENAME';
    els['vw-attr-value'].value = '';
    els['vw-attr-value']._h.input!({});
    vi.advanceTimersByTime(400);
    expect(vorschauen).toEqual([null]);
  });
});
