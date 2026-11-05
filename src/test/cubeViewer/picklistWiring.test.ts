import { describe, it, expect, vi, beforeEach } from 'vitest';

// `./picklistApi` VIA THE PATH (docs/architecture/import-rules.md, "Test mocks"): the module accesses
// the transport directly; a mock only on the facade would let it run into the real
// network.
vi.mock('../../commands/cubeViewer/picklistApi', () => ({
  hasPicklistCube: vi.fn().mockResolvedValue(true),
  fetchElementPicklists: vi.fn().mockResolvedValue({}),
  fetchRulePicklists: vi.fn().mockResolvedValue({}),
  invalidatePicklistResolutions: vi.fn(),
  disposePicklistCachesForServer: vi.fn(),
}));

import type { HostToWebview, WebviewToHost, MatrixData }
  from '../../webviewClient/cubeViewerMonaco/protocol';
import {
  _picklistDims, _picklistMaps, disposePicklistStateForServer,
} from '../../commands/cubeViewer/picklistWiring';
import {
  fetchElementPicklists, fetchRulePicklists, hasPicklistCube, invalidatePicklistResolutions,
  disposePicklistCachesForServer,
} from '../../commands/cubeViewer/picklistApi';

const cfg = { serverUrl: 'https://s:1/api/v1', username: 'u', authType: 'basic' } as never;

describe('Picklist protocol', () => {
  it('carries the area-wide maps raw in the matrix', () => {
    const m: MatrixData = {
      rowElements: [], colElements: [], values: {},
      picklistByElem: { Konto: { K1: 'dimension:D' } },
      picklistByRuleElem: { Status: 'static:A:B' },
    };
    expect(m.picklistByElem!.Konto.K1).toBe('dimension:D');
    expect(m.picklistByRuleElem!.Status).toBe('static:A:B');
  });

  // `satisfies` instead of an annotation on the union: the annotation checks
  // membership just the same, but afterwards narrows the type to the whole
  // union — `back.values` would then be a compile error, even though exactly this
  // field is supposed to be checked here.
  it('knows the resolution message in both directions', () => {
    const out = { type: 'resolvePicklist', def: 'static:A', reqId: 1 } satisfies WebviewToHost;
    const back = { type: 'picklistValues', def: 'static:A', values: ['A'], reqId: 1 } satisfies HostToWebview;
    expect(out.type).toBe('resolvePicklist');
    expect(back.values).toEqual(['A']);
  });

  it('allows null as an answer — a dead reference means everything is allowed', () => {
    const back = { type: 'picklistValues', def: 'dimension:x', values: null, reqId: 2 } satisfies HostToWebview;
    expect(back.values).toBeNull();
  });

  it('knows the single-cell message in both directions', () => {
    const out = {
      type: 'fetchCellPicklist', coordinates: ['K1', 'Txt'], dimensions: ['Konto', 'Mass'], reqId: 3,
    } satisfies WebviewToHost;
    const back = { type: 'cellPicklistDef', def: null, reqId: 3 } satisfies HostToWebview;
    expect(out.coordinates).toHaveLength(2);
    // `null` means "this cell has no picklist", not "empty list".
    expect(back.def).toBeNull();
  });
});

describe('_picklistDims — the cube dimensions from the matrix', () => {
  it('takes axes AND title dimensions, without duplicates', () => {
    expect(_picklistDims({
      rowDims: ['Region'], colDims: ['Monat'], titleAssignments: { Jahr: '2026', Region: 'Nord' },
    })).toEqual(['Region', 'Monat', 'Jahr']);
  });

  it('copes with an empty matrix', () => {
    expect(_picklistDims({})).toEqual([]);
  });
});

describe('_picklistMaps — both area-wide maps, NO cell query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchElementPicklists as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (fetchRulePicklists as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (hasPicklistCube as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('fetches the attribute map and the rule map and reports the control cube', async () => {
    (fetchElementPicklists as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ Region: { Nord: 'dimension:K' } });
    (fetchRulePicklists as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ Status: 'static:A' });

    expect(await _picklistMaps(cfg, 'Plan', ['Region', 'Monat'])).toEqual({
      picklistByElem: { Region: { Nord: 'dimension:K' } },
      picklistByRuleElem: { Status: 'static:A' },
      picklistCubePresent: true,
    });
    expect(fetchElementPicklists).toHaveBeenCalledWith(cfg, ['Region', 'Monat']);
    expect(fetchRulePicklists).toHaveBeenCalledWith(cfg, 'Plan');
  });

  it('throws away the resolved definitions of this server — the refresh hook', async () => {
    await _picklistMaps(cfg, 'Plan', ['Region']);
    expect(invalidatePicklistResolutions).toHaveBeenCalledWith('https://s:1/api/v1');
  });

  it('does not even request the rule text when there is no control cube', async () => {
    (hasPicklistCube as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    expect(await _picklistMaps(cfg, 'Plan', ['Region'])).toEqual({
      picklistByElem: {},
      picklistByRuleElem: {},
      picklistCubePresent: false,
    });
    expect(fetchRulePicklists).not.toHaveBeenCalled();
    // The attribute map does NOT depend on the control cube — it is read anyway.
    expect(fetchElementPicklists).toHaveBeenCalled();
  });
});

describe('Disconnecting', () => {
  it('passes the disconnect on to every picklist cache', () => {
    vi.clearAllMocks();
    disposePicklistStateForServer('https://s:1/api/v1');
    expect(disposePicklistCachesForServer).toHaveBeenCalledWith('https://s:1/api/v1');
  });

  it('does nothing without a server URL', () => {
    vi.clearAllMocks();
    disposePicklistStateForServer('');
    expect(disposePicklistCachesForServer).not.toHaveBeenCalled();
  });
});
