import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn((res: any) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`HTTP ${res.statusCode}`);
    }
  }),
}));

import { apiRequest } from '../../tm1Rest/client';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };
import { fetchProcess, ObjectNotFoundError } from '../../git/processFetcher';

const mockApi = vi.mocked(apiRequest);

beforeEach(() => { mockApi.mockReset(); });

describe('processFetcher', () => {
  it('returns hydrated TM1Process on success', async () => {
    mockApi.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        Name: 'TestProcess',
        PrologProcedure: 'sP();',
        MetadataProcedure: '',
        DataProcedure: 'sD();',
        EpilogProcedure: 'sE();',
        Parameters: [{ Name: 'p1', Type: 'String', Value: 'v', Prompt: 'P' }],
        Variables: [],
        DataSource: { Type: 'None' },
      }),
    } as any);

    const proc = await fetchProcess('TestProcess', CFG);
    expect(proc.name).toBe('TestProcess');
    expect(proc.prolog).toBe('sP();');
    expect(proc.data).toBe('sD();');
    expect(proc.epilog).toBe('sE();');
    expect(proc.parameters).toHaveLength(1);
    expect(proc.dataSource).toEqual({ Type: 'None' });
  });

  it("encodes process name in Processes('...') path", async () => {
    mockApi.mockResolvedValue({
      statusCode: 200,
      body: '{"Name":"X","PrologProcedure":"","MetadataProcedure":"","DataProcedure":"","EpilogProcedure":"","Parameters":[],"Variables":[],"DataSource":{"Type":"None"}}',
    } as any);
    await fetchProcess('My Process', CFG);
    expect(mockApi).toHaveBeenCalledTimes(1);
    const [method, path] = mockApi.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toContain(`Processes('${encodeURIComponent('My Process')}')`);
  });

  it('throws ObjectNotFoundError on 404', async () => {
    mockApi.mockResolvedValue({ statusCode: 404, body: '{"error":"not found"}' } as any);
    await expect(fetchProcess('Missing', CFG)).rejects.toThrow(ObjectNotFoundError);
  });

  it('propagates network error', async () => {
    mockApi.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchProcess('X', CFG)).rejects.toThrow('ECONNREFUSED');
  });

  it('handles missing optional fields with defaults', async () => {
    mockApi.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ Name: 'Bare' }),
    } as any);
    const proc = await fetchProcess('Bare', CFG);
    expect(proc.prolog).toBe('');
    expect(proc.parameters).toEqual([]);
    expect(proc.variables).toEqual([]);
    expect(proc.dataSource).toEqual({ Type: 'None' });
  });
});

describe('processFetcher — the two undeclared lists', () => {
  it('asks for the explicit field list, not a bare GET', async () => {
    // `VariablesUIData` and `UIData` are outside the default projection;
    // a GET without $select does not return them, and `$select=*` truncates.
    mockApi.mockResolvedValue({ statusCode: 200, body: JSON.stringify({ Name: 'P' }) } as any);
    await fetchProcess('P', CFG);
    const url = String(mockApi.mock.calls[0][1]);
    expect(url).toContain('$select=');
    expect(url).toContain('VariablesUIData');
    expect(url).toContain('UIData');
    expect(url).not.toContain('$select=*');
  });

  it('carries both lists through — one per process, not one per variable', async () => {
    mockApi.mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({
        Name: 'P',
        Variables: [{ Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
        VariablesUIData: ['VarType=32\fColType=827\f', 'IgnoredInputVarName=vsSKIP\fVarType=32\fColType=1165\f'],
        UIData: 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f',
        DataSource: { Type: 'ASCII' },
      }),
    } as any);
    const proc = await fetchProcess('P', CFG);
    // Two source columns, one of them ignored — it appears ONLY in the UIData list.
    expect(proc.variables).toHaveLength(1);
    expect(proc.variablesUiData).toHaveLength(2);
    expect(proc.uiData).toBe('CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f');
  });
});
