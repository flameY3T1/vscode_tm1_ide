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
