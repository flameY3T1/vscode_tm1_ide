// Element names that are also Object.prototype members ("constructor", "toString",
// "__proto__", ...) are legal in TM1 (created live on a v11 server 2026-11-05).
// Used as plain-object keys they read inherited members: the parent fetch threw,
// a silent catch emptied the axis metadata, and the grid crashed with
// "i is not iterable". These tests run the three stations with such names.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { _fetchDimParents } from '../commands/cubeViewer/dimStructCache';
import { scopeParentMaps } from '../commands/cubeViewer/axisMetaScopePure';
import { computeIndentDepths } from '../webviewClient/cubeViewerMonaco/rowIndentPure';
import type { Tm1Config } from '../tm1Rest/transport/types';

const KIDS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];
const cfg = { serverUrl: 'http://x', username: 'u', password: 'p', rejectUnauthorized: true, authType: 'Basic' } as Tm1Config;

describe('element names that shadow Object.prototype', () => {
  it('_fetchDimParents keeps every child, none throws', async () => {
    (apiRequest as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ value: KIDS.map(c => ({ ParentName: 'Total', ComponentName: c })) }),
    });
    const maps = await _fetchDimParents('D', cfg);
    for (const k of KIDS) { expect(Object.prototype.hasOwnProperty.call(maps.first, k)).toBe(true); expect(maps.first[k]).toBe('Total'); }
  });

  it('scopeParentMaps walks and reports them as own keys', () => {
    const first = Object.create(null) as Record<string, string>;
    for (const k of KIDS) { first[k] = 'Total'; }
    const scoped = scopeParentMaps(KIDS, { first, all: {} }, new Set(['Total']));
    for (const k of KIDS) { expect(scoped.first[k]).toBe('Total'); }
    expect(Object.keys(scoped.hasChildren)).toEqual([]);
  });

  it('computeIndentDepths indents them under their parent without inherited lookups', () => {
    const tuples = [['Total'], ...KIDS.map(k => [k])];
    // Plain objects as they arrive over postMessage; JSON.parse makes "__proto__" an own key.
    const parents = JSON.parse(JSON.stringify(Object.fromEntries(KIDS.map(k => [k, 'Total'])))) as Record<string, string>;
    expect(computeIndentDepths(tuples, [parents], [{}]).map(d => d[0])).toEqual([0, 1, 1, 1, 1]);
  });
});

import { initStore, setAlias, displayName, matchesFilter } from '../webviewClient/securityUserGroup/statePure';

describe('security manager: user names that shadow Object.prototype', () => {
  it('displayName and matchesFilter fall back to the real name', () => {
    const store = setAlias(initStore([], []), 'Alias', { someoneElse: 'X' });
    for (const u of ['constructor', 'toString', '__proto__']) {
      expect(displayName(store, u)).toBe(u);
      expect(matchesFilter(store, u, 'zz')).toBe(false);
    }
  });
});

import { stripMatrixNameMapPrototypes, mergeParentDelta } from '../webviewClient/cubeViewerMonaco/parentMergePure';
import { buildAxisInfo, collectDescendantsDfs, collectAncestorsRootFirst, collectParentsUnion, collectDirectChildren } from '../webviewClient/cubeViewerMonaco/contextMenuPure';
import { hasCollapsedAncestorDag } from '../webviewClient/cubeViewerMonaco/gridPure';
import { nameMap } from '../utils/nameMapPure';
import type { MatrixData } from '../webviewClient/cubeViewerMonaco/protocol';

describe('cube viewer webview pipeline with names that shadow Object.prototype', () => {
  // Total -> constructor, __proto__, hasOwnProperty; constructor -> toString, valueOf.
  // "constructor" is a CONSOLIDATION here, so it is also a key of the children map.
  const rows = ['Total', 'constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
  // JSON, not a literal: `{ __proto__: 'x' }` in a literal sets the prototype instead of a key.
  const first = JSON.parse('{"constructor":"Total","__proto__":"Total","hasOwnProperty":"Total","toString":"constructor","valueOf":"constructor"}') as Record<string, string>;
  // As the webview receives it: JSON over postMessage, plain objects, "__proto__" an own key.
  const received = (): MatrixData => JSON.parse(JSON.stringify({
    rowElements: rows, colElements: ['m'], values: {},
    rowTuples: rows.map(r => [r]), rowLevels: rows.map(r => [r === 'Total' ? 2 : r === 'constructor' ? 1 : 0]),
    rowDims: ['D'], colDims: ['M'],
    rowParents: [first], rowAllParents: [{}], rowHasChildren: [{ Total: true, constructor: true }],
  })) as MatrixData;

  it('the received map really carries "__proto__" as an own key (premise)', () => {
    expect(Object.prototype.hasOwnProperty.call(received().rowParents![0], '__proto__')).toBe(true);
  });

  it('context menu: children, descendants, ancestors, parents', () => {
    const m = received();
    stripMatrixNameMapPrototypes(m);
    const info = buildAxisInfo(m, 'D', ['D'], [])!;
    expect([...collectDescendantsDfs(['Total'], info)].sort()).toEqual([...rows].sort());
    expect([...collectAncestorsRootFirst(['valueOf'], info)].sort()).toEqual(['Total', 'constructor']);
    expect(collectParentsUnion(['toString'], info)).toEqual(['constructor']);
    expect([...collectDirectChildren(['hasOwnProperty'], info)]).toEqual([]);
    expect([...collectDirectChildren(['constructor'], info)].sort()).toEqual(['toString', 'valueOf']);
  });


  it('collapse: only a really collapsed ancestor hides a row', () => {
    const m = received();
    stripMatrixNameMapPrototypes(m);
    const collapsed = nameMap<boolean>();
    expect(hasCollapsedAncestorDag('valueOf', m.rowAllParents![0], collapsed, m.rowParents![0])).toBe(false);
    collapsed['constructor' as string] = true;
    expect(hasCollapsedAncestorDag('valueOf', m.rowAllParents![0], collapsed, m.rowParents![0])).toBe(true);
    expect(hasCollapsedAncestorDag('hasOwnProperty', m.rowAllParents![0], collapsed, m.rowParents![0])).toBe(false);
  });

  it('a page delta keeps the maps prototype-free and complete', () => {
    const m = received();
    stripMatrixNameMapPrototypes(m);
    const merged = mergeParentDelta(m.rowParents!, [JSON.parse('{"__proto__":"X","isPrototypeOf":"Total"}') as Record<string, string>]);
    expect(Object.getPrototypeOf(merged[0])).toBeNull();
    expect(merged[0].__proto__).toBe('X');
    expect(merged[0].isPrototypeOf).toBe('Total');
    expect(merged[0].constructor).toBe('Total');
  });

  it('leaves Object.prototype untouched', () => {
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(Object.getOwnPropertyNames(Object.getPrototypeOf({})).sort());
    expect(({} as Record<string, unknown>).Total).toBeUndefined();
  });
});

import { initInternalStore, setCellLevel, cellLevel, isDirty, revertAll } from '../webviewClient/_shared/securityMatrixCore';

describe('security matrix with rows named like Object.prototype members', () => {
  // As received over postMessage: "__proto__" is an own key of perms.
  const perms = JSON.parse('{"__proto__":{"G":"READ"},"constructor":{"G":"WRITE"},"A":{"G":"NONE"}}') as Record<string, Record<string, string>>;
  const init = { rows: ['__proto__', 'constructor', 'A', 'toString'], groups: [{ name: 'G', isSystem: false, memberCount: 0 }], perms };

  it('keeps every row and reads only own levels', () => {
    const s = initInternalStore(init);
    expect(Object.keys(s.current).sort()).toEqual(['A', '__proto__', 'constructor']);
    expect(cellLevel(s.current, '__proto__', 'G')).toBe('READ');
    expect(cellLevel(s.current, 'constructor', 'G')).toBe('WRITE');
    expect(cellLevel(s.current, 'toString', 'G')).toBe('NONE');
    expect(isDirty(s)).toBe(false);
  });

  it('edits and reverts the __proto__ row like any other', () => {
    const s = setCellLevel(initInternalStore(init), '__proto__', 'G', 'ADMIN');
    expect(cellLevel(s.current, '__proto__', 'G')).toBe('ADMIN');
    expect(cellLevel(s.current, 'A', 'G')).toBe('NONE');
    expect(isDirty(s)).toBe(true);
    expect(isDirty(revertAll(s))).toBe(false);
  });
});

import { withDisplayFormat, sanitizeDisplayFormats, resolveDisplayFormat } from '../cubeViewer/displayFormatPure';
import { dimsOfSetExpr } from '../mdx/axisFactorsPure';

describe('display formats and MDX factors with names that shadow Object.prototype', () => {
  it('a restored "__proto__" dimension stays a key and pollutes nothing', () => {
    const f = sanitizeDisplayFormats(JSON.parse('{"__proto__":{"x":"0.0"},"D":{"constructor":"#,##0"}}'));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(f.__proto__.x).toBe('0.0');
    expect(f.D.constructor).toBe('#,##0');
  });

  it('an element without a format resolves to none, not to Object', () => {
    const f = withDisplayFormat(sanitizeDisplayFormats({}), 'D', 'a', '0.00');
    const ctx = { colDims: [], colTuple: [], rowDims: ['D'], rowTuple: ['toString'], titles: {} };
    expect(resolveDisplayFormat(f, ctx)).toBeUndefined();
    expect(withDisplayFormat(f, '__proto__', 'constructor', '0').__proto__.constructor).toBe('0');
  });
});

describe('MDX set expression with dimensions named like Object.prototype members', () => {
  it('dimsOfSetExpr lists every dimension', () => {
    expect(dimsOfSetExpr('{[constructor].[a]} * {[toString].[b]} * {[D].[c]}')).toEqual(['constructor', 'toString', 'D']);
  });
});

import { unwrapDisplayFormats, embedDisplayFormats } from '../cubeViewer/mdxFormatEmbedPure';
import { _fetchDimElementsTree } from '../commands/cubeViewer/fetch';
import { fetchAttributeValues, fetchAliasValues } from '../tm1Rest/dimensionElementsApi';
import { stripPrototypesDeep } from '../utils/nameMapPure';

describe('builders and the receive step with names that shadow Object.prototype', () => {
  const api = apiRequest as unknown as ReturnType<typeof vi.fn>;

  it('unwrapDisplayFormats keeps a "__proto__" dimension as a key and pollutes nothing', () => {
    const fm = nameMap<Record<string, string>>();
    fm['__proto__'] = Object.assign(nameMap<string>(), { polluted: '#,##0' });
    const { mdx } = embedDisplayFormats('SELECT {[__proto__].[polluted]} ON 0 FROM [c]', fm);
    const r = unwrapDisplayFormats(mdx);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(r.formats)).toEqual(['__proto__']);
    expect(r.formats['__proto__'].polluted).toBe('#,##0');
  });

  it('_fetchDimElementsTree lists every element under its parent', async () => {
    api.mockImplementation((_m: string, url: string) => Promise.resolve({
      statusCode: 200,
      body: JSON.stringify({ value: url.includes('Edges')
        ? KIDS.map(c => ({ ParentName: 'constructor', ComponentName: c })).filter(e => e.ComponentName !== 'constructor')
        : ['constructor', ...KIDS.filter(k => k !== 'constructor')].map(Name => ({ Name })) }),
    }));
    const tree = await _fetchDimElementsTree('D', cfg);
    api.mockReset();
    expect(tree[0]).toEqual({ name: 'constructor', depth: 0 });
    expect(tree.slice(1).map(t => t.name).sort()).toEqual(KIDS.filter(k => k !== 'constructor').sort());
    expect(tree.slice(1).every(t => t.depth === 1)).toBe(true);
  });

  it('fetchAttributeValues and fetchAliasValues return own keys only', async () => {
    // A fresh response per call: parseBody releases the body it has read.
    api.mockImplementation(() => Promise.resolve({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Name: '__proto__', Attributes: { A: 'x' } }, { Name: 'same', Attributes: { A: 'same' } }] }),
    }));
    const all = await fetchAttributeValues(cfg, 'D', 'D', 'A');
    const alias = await fetchAliasValues(cfg, 'D', 'D', 'A');
    api.mockReset();
    expect(all['__proto__']).toBe('x');
    expect(all['constructor']).toBeUndefined();
    expect(Object.keys(alias)).toEqual(['__proto__']);
    expect(alias['toString']).toBeUndefined();
  });

  it('stripPrototypesDeep reaches nested maps and arrays of maps', () => {
    const msg = JSON.parse('{"type":"t","values":{"__proto__":"a"},"maps":[{"k":{"x":1}}]}') as { values: Record<string, string>; maps: Array<Record<string, Record<string, number>>> };
    stripPrototypesDeep(msg);
    expect(msg.values['constructor']).toBeUndefined();
    expect(msg.values['__proto__']).toBe('a');
    expect(msg.maps[0]['toString']).toBeUndefined();
    expect(msg.maps[0].k['valueOf']).toBeUndefined();
    expect(msg.maps[0].k.x).toBe(1);
  });

  it('stripPrototypesDeep leaves skipped objects and their contents alone', () => {
    const msg = JSON.parse('{"matrix":{"values":{"0,0":{"f":1}},"rowParents":[{"a":"b"}]}}') as { matrix: { values: Record<string, object>; rowParents: Array<Record<string, string>> } };
    stripPrototypesDeep(msg, new Set([msg.matrix.values]));
    expect(Object.getPrototypeOf(msg.matrix.values)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(msg.matrix.values['0,0'])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(msg.matrix.rowParents[0])).toBeNull();
  });
});
