import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../../tm1Rest/client';
import {
  fetchCubeDims,
  fetchDimElements,
  fetchDimAttributes,
  fetchProcessForCapture,
} from '../../../commands/tiTest/helpers';

const mockApi = vi.mocked(apiRequest);
const cfg = { serverUrl: 'http://x', username: 'u', password: 'p' } as never;

beforeEach(() => mockApi.mockReset());

function ok(body: object) {
  return { statusCode: 200, body: JSON.stringify(body) } as never;
}
function status(code: number, body: object = {}) {
  return { statusCode: code, body: JSON.stringify(body) } as never;
}

describe('fetchCubeDims', () => {
  it('returns Names from the collection path when value[] is populated', async () => {
    mockApi.mockResolvedValueOnce(ok({ value: [{ Name: 'Year' }, { Name: 'Region' }] }));
    const r = await fetchCubeDims(cfg, 'Sales');
    expect(r).toEqual(['Year', 'Region']);
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi.mock.calls[0][1]).toMatch(/Cubes\('Sales'\)\/Dimensions/);
  });

  it('falls back to expand path when collection returns empty value[]', async () => {
    mockApi
      .mockResolvedValueOnce(ok({ value: [] }))
      .mockResolvedValueOnce(ok({ Dimensions: [{ Name: 'Period' }] }));
    const r = await fetchCubeDims(cfg, 'Sales');
    expect(r).toEqual(['Period']);
    expect(mockApi).toHaveBeenCalledTimes(2);
  });

  it('falls back to expand path on non-2xx from collection', async () => {
    mockApi
      .mockResolvedValueOnce(status(404))
      .mockResolvedValueOnce(ok({ Dimensions: [{ Name: 'X' }] }));
    const r = await fetchCubeDims(cfg, 'C');
    expect(r).toEqual(['X']);
  });

  it('falls back on apiRequest throw', async () => {
    mockApi
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(ok({ value: [{ Name: 'Y' }] }));
    const r = await fetchCubeDims(cfg, 'C');
    expect(r).toEqual(['Y']);
  });

  it('returns empty array when both paths exhausted', async () => {
    mockApi.mockResolvedValue(status(404));
    const r = await fetchCubeDims(cfg, 'C');
    expect(r).toEqual([]);
  });

  it('encodes cube name in the URL', async () => {
    mockApi.mockResolvedValueOnce(ok({ value: [{ Name: 'D' }] }));
    await fetchCubeDims(cfg, 'My Cube');
    expect(mockApi.mock.calls[0][1]).toContain('My%20Cube');
  });
});

describe('fetchDimElements', () => {
  it('returns elements with name + level from /Elements path', async () => {
    mockApi.mockResolvedValueOnce(
      ok({
        value: [
          { Name: 'Root', Level: 1, Components: [{ Name: 'A' }, { Name: 'B' }] },
          { Name: 'A', Level: 0 },
        ],
      }),
    );
    const r = await fetchDimElements(cfg, 'DimA');
    expect(r).toEqual([
      { name: 'Root', level: 1, children: ['A', 'B'] },
      { name: 'A', level: 0 },
    ]);
  });

  it('coerces non-numeric Level to 0', async () => {
    mockApi.mockResolvedValueOnce(
      ok({ value: [{ Name: 'X', Level: 'bad' as unknown as number }] }),
    );
    const r = await fetchDimElements(cfg, 'D');
    expect(r[0].level).toBe(0);
  });

  it('omits children when Components missing or empty', async () => {
    mockApi.mockResolvedValueOnce(
      ok({ value: [{ Name: 'X', Level: 0, Components: [] }] }),
    );
    const r = await fetchDimElements(cfg, 'D');
    expect(r[0].children).toBeUndefined();
  });

  it('falls back through 3 path variants until one yields elements', async () => {
    mockApi
      .mockResolvedValueOnce(status(404))
      .mockResolvedValueOnce(ok({ value: [] }))
      .mockResolvedValueOnce(ok({ value: [{ Name: 'OK', Level: 0 }] }));
    const r = await fetchDimElements(cfg, 'D');
    expect(r).toEqual([{ name: 'OK', level: 0 }]);
    expect(mockApi).toHaveBeenCalledTimes(3);
  });

  it('returns empty array when all 3 path variants fail', async () => {
    mockApi.mockResolvedValue(status(500));
    const r = await fetchDimElements(cfg, 'D');
    expect(r).toEqual([]);
  });

  it('encodes dim name in URL', async () => {
    mockApi.mockResolvedValueOnce(ok({ value: [{ Name: 'OK', Level: 0 }] }));
    await fetchDimElements(cfg, 'Dim Spaced');
    expect(mockApi.mock.calls[0][1]).toContain('Dim%20Spaced');
  });
});

describe('fetchDimAttributes', () => {
  it('drops unset-alias fallback (value === element name) but keeps real values', async () => {
    // 1st call: ElementAttributes (types) — SITENAME is Alias, Desc is String.
    mockApi.mockResolvedValueOnce(
      ok({ value: [{ Name: 'SITENAME', Type: 'Alias' }, { Name: 'Desc', Type: 'String' }] }),
    );
    // 2nd call: Elements with the Attributes complex-type projection.
    mockApi.mockResolvedValueOnce(
      ok({
        value: [
          // E1: alias echoes the name (unset) → drop; Caption same → drop; Desc kept.
          { Name: 'E1', Attributes: { SITENAME: 'E1', Caption: 'E1', Desc: 'hello' } },
          // E2: real alias (≠ name) kept; String attr equal to name is still kept.
          { Name: 'E2', Attributes: { SITENAME: 'realAlias', Desc: 'E2' } },
        ],
      }),
    );
    const out = await fetchDimAttributes(cfg, 'Stations');
    expect(out).toEqual({
      E1: { Desc: 'hello' },
      E2: { SITENAME: 'realAlias', Desc: 'E2' },
    });
  });

  it('returns {} when the element/attribute paths all fail', async () => {
    mockApi.mockResolvedValue(status(404));
    expect(await fetchDimAttributes(cfg, 'X')).toEqual({});
  });
});

describe('fetchProcessForCapture', () => {
  it('builds ProcessFetchResult with section bodies + parameters + variables', async () => {
    mockApi.mockResolvedValueOnce(
      ok({
        PrologProcedure: 'P_PRO',
        MetadataProcedure: 'P_META',
        DataProcedure: 'P_DATA',
        EpilogProcedure: 'P_EPI',
        DataSource: { Type: 'TM1CubeView' },
        Parameters: [
          { Name: 'p1', Type: 'Numeric', Value: 5 },
          { Name: 'p2', Type: 'String', Value: 'hi' },
        ],
        Variables: [
          { Name: 'v1', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 1 },
          { Name: 'v2', Type: 'String', Position: 2, StartByte: 1, EndByte: 2 },
        ],
      }),
    );
    const r = await fetchProcessForCapture(cfg, 'Proc1');
    expect(r.prolog).toBe('P_PRO');
    expect(r.metadata).toBe('P_META');
    expect(r.data).toBe('P_DATA');
    expect(r.epilog).toBe('P_EPI');
    expect(r.datasource).toEqual({ Type: 'TM1CubeView' });
    expect(r.parameters).toEqual([
      { Name: 'p1', Type: 'Numeric', Value: 5 },
      { Name: 'p2', Type: 'String', Value: 'hi' },
    ]);
    expect(r.variables).toEqual([
      { Name: 'v1', Type: 'Numeric', Position: 1, StartByte: 0, EndByte: 1 },
      { Name: 'v2', Type: 'String', Position: 2, StartByte: 1, EndByte: 2 },
    ]);
  });

  it('normalizes CRLF to LF in every section', async () => {
    mockApi.mockResolvedValueOnce(
      ok({
        PrologProcedure: 'a\r\nb',
        MetadataProcedure: 'c\r\nd',
        DataProcedure: 'e\r\nf',
        EpilogProcedure: 'g\r\nh',
      }),
    );
    const r = await fetchProcessForCapture(cfg, 'P');
    expect(r.prolog).toBe('a\nb');
    expect(r.metadata).toBe('c\nd');
    expect(r.data).toBe('e\nf');
    expect(r.epilog).toBe('g\nh');
  });

  it('coerces unknown Parameter/Variable Type to Numeric (only "String" → String)', async () => {
    mockApi.mockResolvedValueOnce(
      ok({
        Parameters: [{ Name: 'p', Type: 'Weird' }],
        Variables: [{ Name: 'v', Type: 'Weird', Position: 1, StartByte: 0, EndByte: 1 }],
      }),
    );
    const r = await fetchProcessForCapture(cfg, 'P');
    expect(r.parameters[0].Type).toBe('Numeric');
    expect(r.variables[0].Type).toBe('Numeric');
  });

  it('defaults missing fields to safe empties', async () => {
    mockApi.mockResolvedValueOnce(ok({}));
    const r = await fetchProcessForCapture(cfg, 'P');
    expect(r.prolog).toBe('');
    expect(r.metadata).toBe('');
    expect(r.data).toBe('');
    expect(r.epilog).toBe('');
    expect(r.datasource).toEqual({ Type: 'None' });
    expect(r.parameters).toEqual([]);
    expect(r.variables).toEqual([]);
  });

  it('throws on non-2xx status', async () => {
    mockApi.mockResolvedValueOnce(status(404));
    await expect(fetchProcessForCapture(cfg, 'Missing')).rejects.toThrow(/HTTP 404/);
  });

  it('encodes process name in URL', async () => {
    mockApi.mockResolvedValueOnce(ok({}));
    await fetchProcessForCapture(cfg, 'My Proc');
    expect(mockApi.mock.calls[0][1]).toContain('My%20Proc');
  });
});
