import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../commands/cubeViewer/picklistApi', () => ({ resolvePicklist: vi.fn() }));

import { handleCellEditMessage } from '../../commands/cubeViewer/cellEdit';
import * as client from '../../tm1Client';
import { resolvePicklist } from '../../commands/cubeViewer/picklistApi';

describe('handleCellEditMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // `resolvePicklist` is a `vi.fn()` from the `vi.mock` factory, not
    // a `vi.spyOn` — `restoreAllMocks` does NOT reset its call
    // history, otherwise the mock call from the picklist test leaks into the
    // next one.
    (resolvePicklist as ReturnType<typeof vi.fn>).mockReset();
  });

  it('calls updateCells with Dimensions + Coordinates + Value and returns ok=true on 2xx', async () => {
    const post = vi.spyOn(client, 'updateCells').mockResolvedValue({ statusCode: 204, body: '', headers: {} } as any);
    const result = await handleCellEditMessage({
      cubeName: 'P&L',
      dimensions: ['Month', 'Account'],
      coordinates: ['Jan', 'Sales'],
      value: 42,
      ri: 0, ci: 0,
      config: undefined as never,
    });
    expect(post).toHaveBeenCalledWith(
      'P&L',
      [{ Dimensions: ['Month', 'Account'], Coordinates: ['Jan', 'Sales'], Value: 42 }],
      undefined,
    );
    expect(result).toEqual({ ok: true, ri: 0, ci: 0 });
  });

  it('returns ok=false + classified error on 400', async () => {
    vi.spyOn(client, 'updateCells').mockResolvedValue({ statusCode: 400, body: '{"error":{"message":"Bad value"}}' } as any);
    const result = await handleCellEditMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'], value: 'bad', ri: 1, ci: 2, config: undefined as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
      expect(result.error.message).toContain('Bad value');
      expect(result.ri).toBe(1);
      expect(result.ci).toBe(2);
    }
  });

  it('returns ok=false kind=security on 403', async () => {
    vi.spyOn(client, 'updateCells').mockResolvedValue({ statusCode: 403, body: '{"error":{"message":"denied"}}' } as any);
    const result = await handleCellEditMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'], value: 1, ri: 0, ci: 0, config: undefined as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('security');
  });

  it('catches thrown errors (network) and returns kind=network', async () => {
    vi.spyOn(client, 'updateCells').mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const result = await handleCellEditMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'], value: 1, ri: 0, ci: 0, config: { serverUrl: 'https://tm1host:8010' } as never,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.kind).toBe('network'); expect(result.error.message).toContain('refused'); }
  });

  // Fix round 1 (Finding 1): 285 on a cell with a known picklist
  // is interpreted as 'picklist' AND appends the (cached, resolved) allowed
  // values of this definition to the message.
  it('285 with picklistDef: kind picklist, message names the resolved values', async () => {
    vi.spyOn(client, 'updateCells').mockResolvedValue({
      statusCode: 400, body: '{"error":{"code":"285","message":"StringCellUpdateError"}}',
    } as any);
    (resolvePicklist as ReturnType<typeof vi.fn>).mockResolvedValue(['Open', 'Closed', 'Pending']);
    const result = await handleCellEditMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'], value: 'Nonsense',
      ri: 0, ci: 0, config: undefined as never, picklistDef: 'static:Open:Closed:Pending',
    });
    expect(resolvePicklist).toHaveBeenCalledWith(undefined, 'static:Open:Closed:Pending');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('picklist');
      expect(result.error.message).toContain('Open, Closed, Pending');
    }
  });

  // Without picklistDef, 285 stays unclassified (it can also have other
  // causes) — the old, technical TM1 message stays as it is.
  it('285 without picklistDef: kind stays validation, old message stays as it is', async () => {
    vi.spyOn(client, 'updateCells').mockResolvedValue({
      statusCode: 400, body: '{"error":{"code":"285","message":"StringCellUpdateError"}}',
    } as any);
    const result = await handleCellEditMessage({
      cubeName: 'C', dimensions: ['D'], coordinates: ['x'], value: 'Nonsense', ri: 0, ci: 0, config: undefined as never,
    });
    expect(resolvePicklist).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
      expect(result.error.message).toContain('StringCellUpdateError');
    }
  });
});
