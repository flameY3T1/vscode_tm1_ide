import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import {
  initViewControls, showAttrDefs, _resetViewControlsForTest,
} from '../webviewClient/dimensionBrowser/viewControls';
import {
  startView, onAttrDefs, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

type Stub = {
  value: string; innerHTML: string; style: Record<string, string>; disabled: boolean;
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

const stummel = {
  setBase: () => {}, keepMarked: () => {}, removeMarked: () => {},
  applyLayer: () => {}, previewLayer: () => {}, setAlias: () => {}, setSort: () => {}, setLevel: () => {}, setAttrColumns: () => {},
};

describe('the bars of the new path replace the old ones', () => {
  beforeEach(() => { _resetViewControlsForTest(); });

  it('hides the old search and attribute fields and shows the new ones', () => {
    const els = bauDom();
    initViewControls(stummel);
    for (const id of ['filter-input', 'attr-name-filter', 'attr-val-filter', 'attr-name-label']) {
      expect(els[id].style.display, id).toBe('none');
    }
    for (const id of ['vw-filter-input', 'vw-filter-apply', 'vw-attr-name',
      'vw-attr-value', 'vw-attr-label', 'vw-attr-apply']) {
      expect(els[id].style.display, id).toBe('');
    }
  });

  it('fills the select list from the attribute names, with an empty first value', () => {
    const els = bauDom();
    initViewControls(stummel);
    showAttrDefs([{ Name: 'SITENAME', Type: 'Alias' }, { Name: 'KURZ', Type: 'String' }]);
    // The empty first value is the rest position: without it an attribute
    // that nobody chose would stand selected on open.
    expect(els['vw-attr-name'].innerHTML.indexOf('value=""')).toBeLessThan(
      els['vw-attr-name'].innerHTML.indexOf('value="SITENAME"'));
    expect(els['vw-attr-name'].innerHTML).toContain('value="KURZ"');
  });

  it('escapes attribute names instead of letting them into the markup', () => {
    const els = bauDom();
    initViewControls(stummel);
    showAttrDefs([{ Name: '<img src=x>', Type: 'String' }]);
    expect(els['vw-attr-name'].innerHTML).not.toContain('<img');
  });

  it('escapes EVERY special character of an attribute name — also in the value attribute', () => {
    // A TM1 attribute name may carry `"`, `<`, `>`, `&` and `'`. The earlier
    // hand copies of the escaping left `'` standing; the one version from
    // `pure.ts` (via `htmlUtils#escapeHtml`) escapes all five. BOTH
    // select lists are checked: filter attribute and display alias.
    const els = bauDom();
    initViewControls(stummel);
    showAttrDefs([{ Name: `a"<b>&'c`, Type: 'Alias' }]);
    for (const id of ['vw-attr-name', 'vw-alias']) {
      const html = els[id].innerHTML;
      expect(html, id).toContain('a&quot;&lt;b&gt;&amp;&#039;c');
      // No raw character left that could close the value attribute or the element
      // prematurely.
      expect(html.indexOf('a"'), id).toBe(-1);
      expect(html.indexOf('<b>'), id).toBe(-1);
    }
  });

  it('a chosen selection survives the refill', () => {
    const els = bauDom();
    initViewControls(stummel);
    showAttrDefs([{ Name: 'SITENAME' }]);
    els['vw-attr-name'].value = 'SITENAME';
    showAttrDefs([{ Name: 'SITENAME' }, { Name: 'KURZ' }]);
    expect(els['vw-attr-name'].value).toBe('SITENAME');
  });
});

describe('the attribute list reaches the new path', () => {
  let posted: { type: string }[] = [];
  const post = (m: unknown) => { posted.push(m as never); };

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    _resetViewControlsForTest();
  });

  it('asks for the attribute definitions at the start of the view', () => {
    // The new path turns back BEFORE `fetchElements` (`msgSession.ts`), and only there
    // did the definitions come along so far. Without a question of its own the
    // select list would stay empty forever — a filter that nobody can operate.
    bauDom();
    startView('aa', 'aa', post);
    expect(posted.filter((p) => p.type === 'fetchAttrDefs')).toHaveLength(1);
  });

  it('fills the select list from the answer — but only for THIS dimension', () => {
    const els = bauDom();
    initViewControls(stummel);
    startView('aa', 'aa', post);
    onAttrDefs({ type: 'attrDefs', dimName: 'bb', hierName: 'bb', defs: [{ Name: 'FREMD' }] } as never);
    expect(els['vw-attr-name'].innerHTML).not.toContain('FREMD');
    onAttrDefs({ type: 'attrDefs', dimName: 'aa', hierName: 'aa', defs: [{ Name: 'SITENAME' }] } as never);
    expect(els['vw-attr-name'].innerHTML).toContain('SITENAME');
  });
});
