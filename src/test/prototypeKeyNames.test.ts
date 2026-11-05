// Element names that are also Object.prototype members ("constructor", "toString",
// "__proto__", ...) are legal in TM1 (created live on a v11 server 2026-11-05).
// Used as plain-object keys they read inherited members: the parent fetch threw,
// a silent catch emptied the axis metadata, and the grid crashed with
// "i is not iterable". These tests run the three stations with such names.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { _fetchDimParents } from '../commands/cubeViewer/fetch';
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
import { buildAxisInfo, collectDescendantsDfs, collectAncestorsBfs, collectParentsUnion, collectDirectChildren } from '../webviewClient/cubeViewerMonaco/contextMenuPure';
import { buildCubeStructure } from '../webviewClient/cubeViewerMonaco/cubeHierStructure';
import { descendants, allParents as hierAllParents, children as hierChildren, leaves } from '../webviewClient/_shared/hierarchy/operations';
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
    expect([...collectAncestorsBfs(['valueOf'], info)].sort()).toEqual(['Total', 'constructor']);
    expect(collectParentsUnion(['toString'], info)).toEqual(['constructor']);
    expect([...collectDirectChildren(['hasOwnProperty'], info)]).toEqual([]);
    expect([...collectDirectChildren(['constructor'], info)].sort()).toEqual(['toString', 'valueOf']);
  });

  it('hierarchy operations over the cube structure', () => {
    const m = received();
    stripMatrixNameMapPrototypes(m);
    const s = buildCubeStructure(m, 'D', ['D'], [])!;
    expect(descendants(s, 'Total').sort()).toEqual(rows.filter(r => r !== 'Total').sort());
    expect(leaves(s, 'Total').sort()).toEqual(['__proto__', 'hasOwnProperty', 'toString', 'valueOf']);
    expect(hierAllParents(s, 'valueOf')).toEqual(['constructor', 'Total']);
    expect(hierChildren(s, 'toString')).toEqual([]);
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
