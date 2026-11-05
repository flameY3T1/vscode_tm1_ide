import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));

import { apiRequest } from '../tm1Rest/client';
import { compileProcess } from '../tm1Rest/processCompile';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

const mockApi = vi.mocked(apiRequest);
beforeEach(() => { mockApi.mockReset(); });

describe('compileProcess', () => {
  it('POSTs tm1.Compile with empty JSON body', async () => {
    mockApi.mockResolvedValue({ statusCode: 201, body: '{"value":[]}' } as any);
    await compileProcess('My Proc', CFG);

    expect(mockApi).toHaveBeenCalledTimes(1);
    const [method, path, body] = mockApi.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe(`Processes('${encodeURIComponent('My Proc')}')/tm1.Compile`);
    expect(body).toBe('{}');
  });

  it('returns empty array when value is empty', async () => {
    mockApi.mockResolvedValue({ statusCode: 201, body: '{"@odata.context":"...","value":[]}' } as any);
    expect(await compileProcess('P', CFG)).toEqual([]);
  });

  it('parses syntax errors from value array', async () => {
    mockApi.mockResolvedValue({
      statusCode: 201,
      body: JSON.stringify({
        value: [
          { Procedure: 'Prolog', LineNumber: 5, Message: 'Unknown function' },
          { Procedure: 'Data', LineNumber: 12, Message: 'Missing semicolon' },
        ],
      }),
    } as any);
    const errors = await compileProcess('P', CFG);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({ Procedure: 'Prolog', LineNumber: 5, Message: 'Unknown function' });
    expect(errors[1].Message).toBe('Missing semicolon');
  });

  it('throws on 4xx/5xx', async () => {
    mockApi.mockResolvedValue({ statusCode: 404, body: 'not found' } as any);
    await expect(compileProcess('Missing', CFG)).rejects.toThrow(/HTTP 404/);
  });

  // An unreadable answer must not pass as "no errors" — the save would call
  // unvalidated code clean (see processEditor/save.ts).
  it('throws when the body is malformed JSON', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{not json' } as any);
    await expect(compileProcess('P', CFG)).rejects.toThrow(/could not be read/);
  });

  it('throws when value is missing', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{}' } as any);
    await expect(compileProcess('P', CFG)).rejects.toThrow(/could not be read/);
  });
});
