import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  apiRequestBinary: vi.fn(),
}));

import { apiRequest, apiRequestBinary } from '../../../tm1Rest/client';
import {
  deployClone,
  executeClone,
  deleteClone,
  type ProcessShape,
} from '../../../tiTestFramework/rest/cloneProcessApi';

const mockApi = vi.mocked(apiRequest);
const mockBin = vi.mocked(apiRequestBinary);

const cfg = { serverUrl: 'http://x', username: 'u', password: 'p' } as never;

beforeEach(() => {
  mockApi.mockReset();
  mockBin.mockReset();
});

const baseShape: ProcessShape = {
  name: 'TestClone',
  prolog: 'sP();',
  metadata: '',
  data: '',
  epilog: '',
};

describe('deployClone', () => {
  it('deletes any stale clone first, then POSTs Processes with default DataSource None', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' }); // delete-first: none exists
    mockApi.mockResolvedValueOnce({ statusCode: 201, body: '' }); // POST
    await deployClone(cfg, baseShape);
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(mockApi.mock.calls[0][0]).toBe('DELETE');
    const [method, path, body] = mockApi.mock.calls[1];
    expect(method).toBe('POST');
    expect(path).toBe('Processes');
    const parsed = JSON.parse(body!);
    expect(parsed.Name).toBe('TestClone');
    expect(parsed.PrologProcedure).toBe('sP();');
    expect(parsed.DataSource).toEqual({ Type: 'None' });
    expect(parsed.Parameters).toEqual([]);
  });

  it('throws on non-2xx from the POST (delete-first failure is swallowed)', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' }); // delete-first
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'boom' }); // POST
    await expect(deployClone(cfg, baseShape)).rejects.toThrow(/HTTP 500/);
  });

  it('passes custom dataSource + parameters through', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' }); // delete-first
    mockApi.mockResolvedValueOnce({ statusCode: 201, body: '' }); // POST
    await deployClone(cfg, {
      ...baseShape,
      dataSource: { Type: 'View', view: 'V', cube: 'C' },
      parameters: [{ Name: 'p1', Type: 'Numeric', Value: 0 }],
    });
    const parsed = JSON.parse(mockApi.mock.calls[1][2]!);
    expect(parsed.DataSource).toEqual({ Type: 'View', view: 'V', cube: 'C' });
    expect(parsed.Parameters).toHaveLength(1);
  });
});

describe('executeClone', () => {
  it('returns success status when status code is CompletedSuccessfully', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ ProcessExecuteStatusCode: 'CompletedSuccessfully' }),
    });
    const r = await executeClone(cfg, 'C', [{ Name: 'p', Value: 1 }]);
    expect(r.status).toBe('success');
    expect(r.rawStatusCode).toBe('CompletedSuccessfully');
    expect(r.errorLogContent).toBe('');
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('encodes process name + sends Parameters body', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ ProcessExecuteStatusCode: 'CompletedSuccessfully' }),
    });
    await executeClone(cfg, "Has Spaces", [{ Name: 'p1', Value: 'v' }]);
    const [, path, body] = mockApi.mock.calls[0];
    expect(path).toBe(`Processes('Has%20Spaces')/tm1.ExecuteWithReturn`);
    expect(JSON.parse(body!)).toEqual({ Parameters: [{ Name: 'p1', Value: 'v' }] });
  });

  it('maps HasMinorErrors → minorErrors and fetches ErrorLogFile', async () => {
    mockApi
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          ProcessExecuteStatusCode: 'HasMinorErrors',
          ErrorLogFile: { Filename: 'ProcLog_2026.log' },
        }),
      })
    // Error-log content is fetched binary (Windows-1252 safe) + decoded.
    mockBin.mockResolvedValueOnce({ statusCode: 200, body: Buffer.from('WARNING: x\nWARNING: y', 'latin1') });

    const r = await executeClone(cfg, 'C');
    expect(r.status).toBe('minorErrors');
    expect(r.errorLogContent).toContain('WARNING: x');
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockBin).toHaveBeenCalledTimes(1);
    expect(mockBin.mock.calls[0][1]).toBe(`ErrorLogFiles('ProcLog_2026.log')/Content`);
  });

  it('maps QuitCalled', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ ProcessExecuteStatusCode: 'QuitCalled' }),
    });
    expect((await executeClone(cfg, 'C')).status).toBe('quitCalled');
  });

  it('maps RollbackCalled', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ ProcessExecuteStatusCode: 'RollbackCalled' }),
    });
    expect((await executeClone(cfg, 'C')).status).toBe('rollback');
  });

  it('falls back to majorErrors for unknown raw status', async () => {
    mockApi.mockResolvedValueOnce({
      statusCode: 200,
      body: JSON.stringify({ ProcessExecuteStatusCode: 'WeirdNewStatus' }),
    });
    expect((await executeClone(cfg, 'C')).status).toBe('majorErrors');
  });

  it('handles unparseable body', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: 'not-json' });
    const r = await executeClone(cfg, 'C');
    expect(r.status).toBe('success');
    expect(r.rawStatusCode).toBe('CompletedSuccessfully');
  });

  it('throws on non-2xx', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'boom' });
    await expect(executeClone(cfg, 'C')).rejects.toThrow(/HTTP 500/);
  });

  it('swallows errorLog fetch failure (best-effort)', async () => {
    mockApi
      .mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          ProcessExecuteStatusCode: 'HasMinorErrors',
          ErrorLogFile: { Filename: 'x.log' },
        }),
      })
      .mockResolvedValueOnce({ statusCode: 500, body: 'oops' });
    const r = await executeClone(cfg, 'C');
    expect(r.status).toBe('minorErrors');
    expect(r.errorLogContent).toBe('');
  });
});

describe('deleteClone', () => {
  it('DELETEs the process', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' });
    await deleteClone(cfg, 'C');
    expect(mockApi.mock.calls[0][0]).toBe('DELETE');
    expect(mockApi.mock.calls[0][1]).toBe(`Processes('C')`);
  });

  it('tolerates 404 (orphan cleanup)', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' });
    await expect(deleteClone(cfg, 'C')).resolves.toBeUndefined();
  });

  it('throws on other errors', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'boom' });
    await expect(deleteClone(cfg, 'C')).rejects.toThrow(/HTTP 500/);
  });
});
