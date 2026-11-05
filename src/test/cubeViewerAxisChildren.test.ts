import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { getDimChildIndex, _clearDimStructCacheForTest } from '../commands/cubeViewer/dimStructCache';
import { dispatch } from '../webviews/dispatchTablePure';
import { cubeViewerTable } from '../commands/cubeViewer/messaging';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg = { serverUrl: 'http://x', username: 'u', password: 'p', rejectUnauthorized: false } as Tm1Config;

function reply(body: unknown) {
  return { statusCode: 200, body: JSON.stringify(body) };
}

describe('getDimChildIndex', () => {
  beforeEach(() => {
    _clearDimStructCacheForTest();
    vi.mocked(apiRequest).mockReset();
  });

  it('inverts the parent map and knows the parent set', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) => {
      if (path.includes('Hierarchies(') && path.includes('$select=Name')) {
        return reply({ '@odata.etag': 'W/"1"', Name: 'D' });
      }
      if (path.includes('/Elements?')) {
        return reply({ value: [{ Name: 'k1', Level: 0 }, { Name: 'p', Level: 1 }] });
      }
      return reply({ value: [
        { ParentName: 'p', ComponentName: 'k1' },
        { ParentName: 'p', ComponentName: 'k2' },
        { ParentName: 'q', ComponentName: 'k1' },
      ] });
    });

    const idx = await getDimChildIndex('D', cfg);
    expect(idx.children.get('p')).toEqual(['k1', 'k2']);
    expect(idx.children.get('q')).toEqual(['k1']);
    expect([...idx.parentSet].sort()).toEqual(['p', 'q']);
  });

  it('builds the index only once per cache entry', async () => {
    vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) => {
      if (path.includes('Hierarchies(') && path.includes('$select=Name')) {
        return reply({ '@odata.etag': 'W/"1"', Name: 'D' });
      }
      if (path.includes('/Elements?')) { return reply({ value: [] }); }
      return reply({ value: [{ ParentName: 'p', ComponentName: 'k' }] });
    });

    const a = await getDimChildIndex('D', cfg);
    const b = await getDimChildIndex('D', cfg);
    expect(b).toBe(a);
  });
});

describe('fetchAxisChildren handler', () => {
  beforeEach(() => {
    _clearDimStructCacheForTest();
    vi.mocked(apiRequest).mockReset();
    // Edge tree: root -> [a, b]; a -> [a1]; b -> [b1].
    vi.mocked(apiRequest).mockImplementation(async (_m: string, path: string) => {
      if (path.includes('Hierarchies(') && path.includes('$select=Name')) {
        return reply({ '@odata.etag': 'W/"1"', Name: 'D' });
      }
      if (path.includes('/Elements?')) { return reply({ value: [] }); }
      return reply({ value: [
        { ParentName: 'wurzel', ComponentName: 'a' },
        { ParentName: 'wurzel', ComponentName: 'b' },
        { ParentName: 'a', ComponentName: 'a1' },
        { ParentName: 'b', ComponentName: 'b1' },
      ] });
    });
  });

  function makeCtx() {
    const out: any[] = [];
    const panel = { webview: { postMessage: (m: any) => out.push(m) } } as any;
    const ctx = {
      panelKey: 'p', panel, cubeName: 'C',
      existingViewName: undefined, existingViewIsPrivate: false, config: cfg,
    };
    return { out, ctx };
  }

  it('returns direct children and the descendants within the filter list', async () => {
    const { out, ctx } = makeCtx();
    await dispatch(cubeViewerTable, { type: 'fetchAxisChildren', dimName: 'D', elem: 'wurzel', within: ['a', 'a1'] }, ctx);
    const msg = out.pop();
    expect(msg.children).toEqual(['a', 'b']);
    expect(msg.descendants.sort()).toEqual(['a', 'a1']);
  });

  it('returns the full descendants without within', async () => {
    const { out, ctx } = makeCtx();
    await dispatch(cubeViewerTable, { type: 'fetchAxisChildren', dimName: 'D', elem: 'wurzel' }, ctx);
    expect(out.pop().descendants.sort()).toEqual(['a', 'a1', 'b', 'b1']);
  });

  it('answers even for an unknown element, instead of staying silent', async () => {
    const { out, ctx } = makeCtx();
    await dispatch(cubeViewerTable, { type: 'fetchAxisChildren', dimName: 'D', elem: 'gibtsnicht' }, ctx);
    const msg = out.pop();
    expect(msg.children).toEqual([]);
    expect(msg.descendants).toEqual([]);
  });
});
