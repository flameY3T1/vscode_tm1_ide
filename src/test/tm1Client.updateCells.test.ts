import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../tm1Rest/client';
import { updateCells } from '../cubeViewer/cubeWriteApi';

describe('updateCells', () => {
  beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

  it('POSTs Cells/Tuple@odata.bind with Value at top-level as a JSON number', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' } as any);
    const edits = [{ Dimensions: ['Month', 'Account'], Coordinates: ['Jan', 'Sales'], Value: 42 }];
    const res = await updateCells('P&L', edits, undefined as never);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(1);
    const [method, path, body] = vi.mocked(apiRequest).mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe("Cubes('P%26L')/tm1.Update");
    // Must be a JSON number literal, not a quoted "42" — the measurement
    // from 2026-08-12 shows: a string value is parsed server-side using the locale.
    expect(body).toContain('"Value":42');
    expect(JSON.parse(body as string)).toEqual({
      Cells: [{
        'Tuple@odata.bind': [
          "Dimensions('Month')/Hierarchies('Month')/Elements('Jan')",
          "Dimensions('Account')/Hierarchies('Account')/Elements('Sales')",
        ],
      }],
      Value: 42,
    });
    expect(res.statusCode).toBe(200);
  });

  it('sends numeric values as a JSON number (incl. fractional, zero, negative) and keeps text/spread/clear as strings', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' } as any);
    const cases: { value: number | string; expected: number | string }[] = [
      { value: 0,       expected: 0 },
      { value: -100,    expected: -100 },
      { value: 15.5,    expected: 15.5 },
      { value: 1234.5,  expected: 1234.5 },
      { value: '',      expected: '' },
      { value: '~',     expected: '~' },
      { value: '+100',  expected: '+100' },
      { value: '*1.5',  expected: '*1.5' },
      { value: 'Hello', expected: 'Hello' },
    ];
    for (const c of cases) {
      vi.mocked(apiRequest).mockClear();
      await updateCells('C', [{ Dimensions: ['D'], Coordinates: ['x'], Value: c.value }], undefined as never);
      const rawBody = vi.mocked(apiRequest).mock.calls[0][2] as string;
      const body = JSON.parse(rawBody);
      expect(body.Value).toBe(c.expected);
      expect(typeof body.Value).toBe(typeof c.value === 'number' ? 'number' : 'string');
    }
  });

  it('bubbles non-2xx responses without throwing (caller classifies)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 403, body: '{"error":{"message":"denied"}}' } as any);
    const res = await updateCells('C', [{ Dimensions: ['D'], Coordinates: ['x'], Value: 1 }], undefined as never);
    expect(res.statusCode).toBe(403);
  });

  it('stops at first non-2xx when multiple edits are supplied', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 204, body: '' } as any)
      .mockResolvedValueOnce({ statusCode: 400, body: '{"error":{"message":"bad"}}' } as any)
      .mockResolvedValueOnce({ statusCode: 204, body: '' } as any);
    const edits = [
      { Dimensions: ['D'], Coordinates: ['A'], Value: 1 },
      { Dimensions: ['D'], Coordinates: ['B'], Value: 2 },
      { Dimensions: ['D'], Coordinates: ['C'], Value: 3 },
    ];
    const res = await updateCells('Cube', edits, undefined as never);
    expect(res.statusCode).toBe(400);
    expect(vi.mocked(apiRequest)).toHaveBeenCalledTimes(2);
  });

  it('doubles apostrophes in cube names before percent-encoding (OData key escaping)', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' } as any);
    const edits = [{ Dimensions: ['D'], Coordinates: ['x'], Value: 1 }];

    await updateCells("O'Brien", edits, undefined as never);
    const path1 = vi.mocked(apiRequest).mock.calls[0][1];
    expect(path1).toBe("Cubes('O''Brien')/tm1.Update");

    await updateCells("X'Y&Z", edits, undefined as never);
    const path2 = vi.mocked(apiRequest).mock.calls[1][1];
    expect(path2).toBe("Cubes('X''Y%26Z')/tm1.Update");
  });

  it('OData-escapes apostrophes in dimension and element names inside Tuple URIs', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' } as any);
    await updateCells('C', [{ Dimensions: ["D'1", 'D2'], Coordinates: ["E'1", "E''2"], Value: 5 }], undefined as never);
    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);
    expect(body.Cells[0]['Tuple@odata.bind']).toEqual([
      "Dimensions('D''1')/Hierarchies('D''1')/Elements('E''1')",
      "Dimensions('D2')/Hierarchies('D2')/Elements('E''''2')",
    ]);
  });

  it('throws when Dimensions and Coordinates lengths differ', async () => {
    await expect(
      updateCells('C', [{ Dimensions: ['A', 'B'], Coordinates: ['x'], Value: 1 }], undefined as never),
    ).rejects.toThrow(/length mismatch/i);
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalled();
  });

  it('throws when edits array is empty', async () => {
    await expect(updateCells('C', [], undefined as never)).rejects.toThrow(/empty/i);
  });
});
