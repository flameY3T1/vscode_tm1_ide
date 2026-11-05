import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Expanding/collapsing in the Cube Viewer triggers a full refresh, and every refresh
 * rebuilds the axis metadata: per axis dimension a full table
 * `Elements?$select=Name,Level` PLUS the complete edge list `Edges`. Measured live
 * against 11.8 (2026-08-08, cube `Reporting`): for `Konten` (160 659
 * elements) that is 16.9 MB + 23.7 MB per click, for
 * `AllocStations` (211 852) 20.0 MB + 26.2 MB — fetched anew every time, even though
 * the dimension structure does not change between two clicks.
 *
 * Instead of a guessed TTL, the cache validates against the server. Proven live:
 *  • The Hierarchy entity carries `@odata.etag` even with `$select=Name` (≈180 B,
 *    1 ms) — the probe needs no response headers, the value is in the body.
 *    (`ApiResponse` only passes statusCode+body through; headers would mean
 *    rebuilding the transport.)
 *  • This ETag is CHARACTER-IDENTICAL to the ETag of the Elements query.
 *  • It also changes on a pure EDGE change, even though the
 *    `Name,Level` projection stays identical. So it is a
 *    hierarchy version stamp, not a content hash of the query — and thereby
 *    also covers the Edges cache, which itself delivers no ETag at all.
 */

vi.mock('../../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));

import { apiRequest } from '../../tm1Client';
import {
  getDimStructure, invalidateDimStructure, _clearDimStructCacheForTest,
  DIM_STRUCT_ELEMENT_BUDGET,
} from '../../commands/cubeViewer/dimStructCache';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;

const CFG = { serverUrl: 'https://tm1.example:12354/api/v1' } as unknown as Tm1Config;
const CFG2 = { serverUrl: 'https://other.example:12354/api/v1' } as unknown as Tm1Config;

/** What the server delivers for each version. */
interface Fixture {
  etag: string;
  elements: Array<{ Name: string; Level: number }>;
  edges: Array<{ ParentName: string; ComponentName: string }>;
}

const V1: Fixture = {
  etag: 'W/"aaa"',
  elements: [{ Name: 'Total', Level: 1 }, { Name: 'A', Level: 0 }],
  edges: [{ ParentName: 'Total', ComponentName: 'A' }],
};
const V2: Fixture = {
  etag: 'W/"bbb"',
  elements: [{ Name: 'Total', Level: 1 }, { Name: 'A', Level: 0 }, { Name: 'B', Level: 0 }],
  edges: [{ ParentName: 'Total', ComponentName: 'A' }, { ParentName: 'Total', ComponentName: 'B' }],
};

/** Counts the requests by kind, so that a test can prove "did NOT reload". */
function callKinds(): { probe: number; elements: number; edges: number } {
  const urls = mockApi.mock.calls.map((c) => String(c[1]));
  return {
    probe: urls.filter((u) => /Hierarchies\('[^']+'\)\?/.test(u)).length,
    elements: urls.filter((u) => u.includes('/Elements?')).length,
    edges: urls.filter((u) => u.includes('/Edges?')).length,
  };
}

/** Server double: delivers the currently set fixture. */
let current: Fixture = V1;
let probeStatus = 200;
let probeBody: string | null = null;

function wireServer(): void {
  mockApi.mockImplementation((_method: string, url: string) => {
    if (/Hierarchies\('[^']+'\)\?/.test(url)) {
      return Promise.resolve({
        statusCode: probeStatus,
        body: probeBody ?? JSON.stringify({ '@odata.etag': current.etag, Name: 'dimA' }),
      });
    }
    if (url.includes('/Elements?')) {
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: current.elements }) });
    }
    if (url.includes('/Edges?')) {
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: current.edges }) });
    }
    throw new Error(`unerwarteter Request: ${url}`);
  });
}

beforeEach(() => {
  _clearDimStructCacheForTest();
  mockApi.mockReset();
  current = V1;
  probeStatus = 200;
  probeBody = null;
  wireServer();
});

describe('getDimStructure — ETag-validated cache', () => {
  it('a read still running across an invalidation neither serves new callers nor fills the cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockApi.mockImplementationOnce(async (_m: string, url: string) => {
      await gate;
      return { statusCode: 200, body: JSON.stringify({ '@odata.etag': V1.etag, Name: 'dimA' }), url };
    });
    const old = getDimStructure('dimA', CFG);
    invalidateDimStructure(CFG.serverUrl);
    current = V2;
    const fresh = await getDimStructure('dimA', CFG);
    expect(fresh.levels.get('B')).toBe(0);
    release();
    await old;
    mockApi.mockClear();
    // V2's stamp is cached; the stale V1 answer must not have overwritten it.
    const again = await getDimStructure('dimA', CFG);
    expect(again.levels.get('B')).toBe(0);
    expect(callKinds()).toEqual({ probe: 1, elements: 0, edges: 0 });
  });

  it('fetches levels and edges the first time and returns both prepared', async () => {
    const s = await getDimStructure('dimA', CFG);
    expect(s.levels.get('Total')).toBe(1);
    expect(s.levels.get('A')).toBe(0);
    expect(s.parents.first['A']).toBe('Total');
    expect(s.parents.all['A']).toEqual(['Total']);
    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
  });

  it('reloads nothing when the ETag is unchanged — only the probe goes out', async () => {
    const first = await getDimStructure('dimA', CFG);
    mockApi.mockClear();

    const second = await getDimStructure('dimA', CFG);

    expect(callKinds()).toEqual({ probe: 1, elements: 0, edges: 0 });
    expect(second.levels).toEqual(first.levels);
    expect(second.parents).toEqual(first.parents);
  });

  it('reloads when the ETag changed and returns the new structure', async () => {
    await getDimStructure('dimA', CFG);
    mockApi.mockClear();
    current = V2;

    const s = await getDimStructure('dimA', CFG);

    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
    expect(s.levels.get('B')).toBe(0);
    expect(s.parents.all['B']).toEqual(['Total']);
  });

  it('serves nothing stale when the probe fails — full query instead', async () => {
    await getDimStructure('dimA', CFG);
    mockApi.mockClear();
    probeStatus = 500;
    current = V2;

    const s = await getDimStructure('dimA', CFG);

    expect(callKinds().elements).toBe(1);
    expect(callKinds().edges).toBe(1);
    expect(s.levels.get('B')).toBe(0);
  });

  it('does not cache a failed edge read under the valid ETag', async () => {
    // Review 2026-10-02: a 5xx on Edges returned empty maps, which were cached
    // under the current ETag — the dimension stayed flat until it changed.
    mockApi.mockImplementation((_m: string, url: string) => {
      if (/Hierarchies\('[^']+'\)\?/.test(url)) {
        return Promise.resolve({ statusCode: 200, body: JSON.stringify({ '@odata.etag': current.etag }) });
      }
      if (url.includes('/Edges?')) { return Promise.resolve({ statusCode: 503, body: '' }); }
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: current.elements }) });
    });
    await expect(getDimStructure('dimA', CFG)).rejects.toThrow(/HTTP 503/);

    wireServer();
    const s = await getDimStructure('dimA', CFG);
    expect(s.parents.first).toEqual({ A: 'Total' });
  });

  it('serves nothing stale when the probe carries no ETag', async () => {
    await getDimStructure('dimA', CFG);
    mockApi.mockClear();
    probeBody = JSON.stringify({ Name: 'dimA' }); // no @odata.etag
    current = V2;

    const s = await getDimStructure('dimA', CFG);

    expect(callKinds().elements).toBe(1);
    expect(s.levels.get('B')).toBe(0);
  });

  it('separates entries by server — the same dim name on two servers shares nothing', async () => {
    await getDimStructure('dimA', CFG);
    mockApi.mockClear();

    await getDimStructure('dimA', CFG2);

    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
  });

  it('keeps two users on the same URL apart — element security differs per user', async () => {
    await getDimStructure('dimA', { ...CFG, username: 'admin' } as Tm1Config);
    mockApi.mockClear();

    await getDimStructure('dimA', { ...CFG, username: 'reader' } as Tm1Config);

    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
  });

  it('separates entries by dimension', async () => {
    await getDimStructure('dimA', CFG);
    mockApi.mockClear();

    await getDimStructure('dimB', CFG);

    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
  });

  it('bundles concurrent calls into ONE query', async () => {
    const [a, b] = await Promise.all([
      getDimStructure('dimA', CFG),
      getDimStructure('dimA', CFG),
    ]);

    expect(callKinds()).toEqual({ probe: 1, elements: 1, edges: 1 });
    expect(a.levels).toEqual(b.levels);
  });

  it('invalidateDimStructure forces a dimension to reload', async () => {
    await getDimStructure('dimA', CFG);
    await getDimStructure('dimB', CFG);
    mockApi.mockClear();

    invalidateDimStructure(CFG.serverUrl, 'dimA');

    await getDimStructure('dimA', CFG);
    expect(callKinds().elements).toBe(1);

    mockApi.mockClear();
    await getDimStructure('dimB', CFG); // untouched
    expect(callKinds().elements).toBe(0);
  });

  it('invalidateDimStructure without arguments clears everything', async () => {
    await getDimStructure('dimA', CFG);
    await getDimStructure('dimB', CFG2);
    mockApi.mockClear();

    invalidateDimStructure();

    await getDimStructure('dimA', CFG);
    await getDimStructure('dimB', CFG2);
    expect(callKinds().elements).toBe(2);
  });

  it('does not cache a failure: after an Elements error it fetches again', async () => {
    mockApi.mockImplementation((_m: string, url: string) => {
      if (/Hierarchies\('[^']+'\)\?/.test(url)) {
        return Promise.resolve({ statusCode: 200, body: JSON.stringify({ '@odata.etag': V1.etag }) });
      }
      if (url.includes('/Elements?')) { return Promise.reject(new Error('boom')); }
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: V1.edges }) });
    });

    await expect(getDimStructure('dimA', CFG)).rejects.toThrow('boom');

    wireServer();
    mockApi.mockClear();
    const s = await getDimStructure('dimA', CFG);
    expect(callKinds().elements).toBe(1);
    expect(s.levels.get('Total')).toBe(1);
  });
});

/**
 * The cache now HOLDS what used to become garbage again after every refresh. For `Konten`
 * that is three maps over 160 659 entries. The peak consumption stays the same
 * (the structures were built per refresh anyway), the steady-state consumption
 * rises — hence a cap, and it is on the number of held elements rather than
 * on the number of entries: a dimension with 200 000 elements and one with
 * 68 do not cost the same.
 */
function bigFixture(n: number, etag: string): Fixture {
  const elements = Array.from({ length: n }, (_, i) => ({ Name: `E${i}`, Level: 0 }));
  return { etag, elements, edges: [] };
}

describe('getDimStructure — memory cap', () => {
  const HALF = Math.floor(DIM_STRUCT_ELEMENT_BUDGET / 2) + 1;

  it('evicts the least recently used entry when the budget is exceeded', async () => {
    current = bigFixture(HALF, 'W/"a"'); await getDimStructure('big1', CFG);
    current = bigFixture(HALF, 'W/"b"'); await getDimStructure('big2', CFG);
    mockApi.mockClear();

    // big1 came first and is therefore the oldest access → evicted.
    current = bigFixture(HALF, 'W/"a"');
    await getDimStructure('big1', CFG);
    expect(callKinds().elements).toBe(1);
  });

  it('counts use, not insertion order — the freshly read one stays', async () => {
    current = bigFixture(HALF, 'W/"a"'); await getDimStructure('big1', CFG);
    current = bigFixture(HALF, 'W/"b"'); await getDimStructure('big2', CFG);
    // big2 displaced big1; fetching big1 again displaces big2.
    current = bigFixture(HALF, 'W/"a"'); await getDimStructure('big1', CFG);
    mockApi.mockClear();

    current = bigFixture(HALF, 'W/"a"');
    await getDimStructure('big1', CFG);
    expect(callKinds()).toEqual({ probe: 1, elements: 0, edges: 0 });
  });

  it('keeps a dimension that on its own is already over the budget', async () => {
    current = bigFixture(DIM_STRUCT_ELEMENT_BUDGET + 10, 'W/"xl"');
    await getDimStructure('xl', CFG);
    mockApi.mockClear();

    await getDimStructure('xl', CFG);

    // It is the most expensive reload case of all — throwing exactly that one away would be
    // the opposite of the purpose. Everything else had to make room for it.
    expect(callKinds()).toEqual({ probe: 1, elements: 0, edges: 0 });
  });
});

describe('getDimStructure — shared in-flight load vs. panel abort (review 2026-10-07, R2)', () => {
  beforeEach(() => { _clearDimStructCacheForTest(); mockApi.mockReset(); });

  it('closing the panel that started the load does not fail it for a second waiter', async () => {
    const { runWithAbortSignal, currentAbortSignal } = await import('../../tm1Rest/transport/abortScope');
    const release: Array<() => void> = [];
    mockApi.mockImplementation(async (_m: string, url: string) => {
      if (/\?\$select=Name$/.test(url)) { return { statusCode: 200, body: JSON.stringify({ '@odata.etag': V1.etag }) }; }
      // Mirrors the transport: a GET rejects when its scope's signal aborts.
      const signal = currentAbortSignal();
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        release.push(() => resolve({
          statusCode: 200,
          body: JSON.stringify({ value: url.includes('Edges') ? V1.edges : V1.elements }),
        }));
      });
    });
    const a = new AbortController();
    const b = new AbortController();
    const first = runWithAbortSignal(a.signal, () => getDimStructure('D', CFG));
    const second = runWithAbortSignal(b.signal, () => getDimStructure('D', CFG));
    await vi.waitFor(() => expect(release.length).toBe(2));
    a.abort();
    release.forEach((r) => r());
    const [sa, sb] = await Promise.all([first, second]);
    expect(sb.levels.get('Total')).toBe(1);
    expect(sa).toBe(sb);
  });
});
