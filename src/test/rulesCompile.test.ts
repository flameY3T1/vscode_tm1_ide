import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../tm1Rest/client';
import { checkRules } from '../tm1Rest/rulesCompile';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

const mockApi = vi.mocked(apiRequest);
beforeEach(() => { mockApi.mockReset(); });

describe('checkRules', () => {
  it('POSTs tm1.CheckRules with Rules body', async () => {
    mockApi.mockResolvedValue({ statusCode: 201, body: '{"value":[]}' } as any);
    await checkRules('SalesCube', "['A'] = N: 1;", CFG);

    expect(mockApi).toHaveBeenCalledTimes(1);
    const [method, path, body] = mockApi.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe(`Cubes('${encodeURIComponent('SalesCube')}')/tm1.CheckRules`);
    expect(JSON.parse(body as string)).toEqual({ Rules: "['A'] = N: 1;" });
  });

  it('returns empty array on no errors', async () => {
    mockApi.mockResolvedValue({ statusCode: 201, body: '{"value":[]}' } as any);
    expect(await checkRules('C', 'rules', CFG)).toEqual([]);
  });

  it('parses errors from value array', async () => {
    mockApi.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({ value: [{ LineNumber: 3, Message: 'fehlende eckige Klammer' }] }),
    } as any);
    const errs = await checkRules('C', 'broken', CFG);
    expect(errs).toHaveLength(1);
    expect(errs[0].LineNumber).toBe(3);
    expect(errs[0].Message).toMatch(/Klammer/);
  });

  it('throws on 4xx/5xx', async () => {
    mockApi.mockResolvedValue({ statusCode: 404, body: 'not found' } as any);
    await expect(checkRules('Missing', '', CFG)).rejects.toThrow(/HTTP 404/);
  });

  it('returns empty when body malformed', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{not json' } as any);
    expect(await checkRules('C', '', CFG)).toEqual([]);
  });

  it('encodes cube name with apostrophe', async () => {
    mockApi.mockResolvedValue({ statusCode: 201, body: '{"value":[]}' } as any);
    await checkRules("Sales'Cube", '', CFG);
    expect(mockApi.mock.calls[0][1]).toContain(`Cubes('Sales''Cube')`);
  });
});
