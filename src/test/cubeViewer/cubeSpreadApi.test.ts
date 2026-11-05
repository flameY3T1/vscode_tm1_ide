import { describe, it, expect, vi, afterEach } from 'vitest';
import * as client from '../../tm1Rest/client';
import { spreadCell, buildSpreadValue, buildSpreadMdx } from '../../cubeViewer/cubeSpreadApi';

const dims = ['Month', 'Region'];
const coords = ['Q1', 'Europe'];

afterEach(() => vi.restoreAllMocks());

describe('buildSpreadValue', () => {
  it('proportional → "P<N>"', () => {
    expect(buildSpreadValue('proportional', 1000)).toBe('P1000');
    expect(buildSpreadValue('proportional', -50)).toBe('P-50');
    expect(buildSpreadValue('proportional', 3.14)).toBe('P3.14');
  });
  it('repeat → "LR<N>" (value into every leaf)', () => {
    expect(buildSpreadValue('repeat', 200)).toBe('LR200');
  });
  it('percentage → "R%<100+N>" (adjust by N %)', () => {
    expect(buildSpreadValue('percentage', 10)).toBe('R%110');
    expect(buildSpreadValue('percentage', -10)).toBe('R%90');
    expect(buildSpreadValue('percentage', 2.5)).toBe('R%102.5');
  });
  it('clear → literal "R0"', () => {
    expect(buildSpreadValue('clear', 0)).toBe('R0');
    expect(buildSpreadValue('clear', 999)).toBe('R0');
  });
});

describe('buildSpreadMdx', () => {
  it('builds a single-axis crossjoin tuple for 2 dimensions', () => {
    const mdx = buildSpreadMdx('Sales', ['Month', 'Region'], ['Q1', 'Europe']);
    expect(mdx).toBe("SELECT {([Month].[Month].[Q1], [Region].[Region].[Europe])} ON 0 FROM [Sales]");
  });
  it('supports 3+ dimensions in ONE tuple (TM1 rejects >2 axes on spread)', () => {
    const mdx = buildSpreadMdx('C', ['A', 'B', 'D'], ['a', 'b', 'd']);
    expect(mdx).toBe("SELECT {([A].[A].[a], [B].[B].[b], [D].[D].[d])} ON 0 FROM [C]");
  });
  it('handles 1 dimension (edge case)', () => {
    const mdx = buildSpreadMdx('C', ['A'], ['a']);
    expect(mdx).toBe("SELECT {([A].[A].[a])} ON 0 FROM [C]");
  });
  it('escapes "]" in names with "]]"', () => {
    const mdx = buildSpreadMdx('C', ['A]B'], ['x]y']);
    expect(mdx).toBe("SELECT {([A]]B].[A]]B].[x]]y])} ON 0 FROM [C]");
  });
  it('throws on length mismatch', () => {
    expect(() => buildSpreadMdx('C', ['A'], ['x', 'y'])).toThrow(/length mismatch/i);
  });
  it('throws on empty dimensions array', () => {
    expect(() => buildSpreadMdx('C', [], [])).toThrow(/at least one dimension/i);
  });
});

describe('spreadCell lifecycle', () => {
  it('runs 3 calls: ExecuteMDX → Cellsets/tm1.Update → DELETE Cellsets', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ statusCode: 200, body: '{"ID":"CS_123"}', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any);

    const res = await spreadCell('Sales', 'proportional', dims, coords, 1000, undefined as never);

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toBe('POST');
    expect(spy.mock.calls[0][1]).toBe('ExecuteMDX');
    expect(JSON.parse(spy.mock.calls[0][2] as string).MDX).toContain("FROM [Sales]");

    expect(spy.mock.calls[1][0]).toBe('POST');
    expect(spy.mock.calls[1][1]).toBe("Cellsets('CS_123')/tm1.Update");
    expect(JSON.parse(spy.mock.calls[1][2] as string)).toEqual({ BeginOrdinal: 0, Value: 'P1000' });

    expect(spy.mock.calls[2][0]).toBe('DELETE');
    expect(spy.mock.calls[2][1]).toBe("Cellsets('CS_123')");

    expect(res.statusCode).toBe(204);
  });

  it('still DELETEs cellset when tm1.Update returns 4xx', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ statusCode: 200, body: '{"ID":"CS_456"}', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"DataSpreadFailed"}}', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any);

    const res = await spreadCell('C', 'repeat', ['D'], ['x'], 5, undefined as never);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2][0]).toBe('DELETE');
    expect(res.statusCode).toBe(400);
  });

  it('swallows DELETE errors so they do not mask the real result', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ statusCode: 200, body: '{"ID":"CS_789"}', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any)
      .mockRejectedValueOnce(new Error('network glitch during DELETE'));

    const res = await spreadCell('C', 'clear', ['D'], ['x'], 0, undefined as never);
    expect(res.statusCode).toBe(204);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not run tm1.Update or DELETE if ExecuteMDX fails', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ statusCode: 404, body: '{"error":{"message":"cube not found"}}', headers: {} } as any);

    const res = await spreadCell('Missing', 'proportional', ['D'], ['x'], 1, undefined as never);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
  });

  it('OData-escapes apostrophes in cellset path', async () => {
    const spy = vi.spyOn(client, 'apiRequest')
      .mockResolvedValueOnce({ statusCode: 200, body: '{"ID":"O\\u0027Cellset"}', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '', headers: {} } as any);
    await spreadCell('C', 'repeat', ['D'], ['x'], 1, undefined as never);
    expect(spy.mock.calls[1][1]).toBe("Cellsets('O''Cellset')/tm1.Update");
    expect(spy.mock.calls[2][1]).toBe("Cellsets('O''Cellset')");
  });
});
