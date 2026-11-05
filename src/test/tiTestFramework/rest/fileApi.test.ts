import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  apiRequestBinary: vi.fn(),
}));

import { apiRequest, apiRequestBinary } from '../../../tm1Rest/client';
import {
  readFile,
  deleteFile,
  readErrorLog,
  deleteErrorLog,
} from '../../../tiTestFramework/rest/fileApi';
import { decodeServerText } from '../../../utils/serverText';

const mockApi = vi.mocked(apiRequest);
const cfg = { serverUrl: 'http://x', username: 'u', password: 'p' } as never;

beforeEach(() => mockApi.mockReset());

describe('decodeServerText', () => {
  it('decodes Windows-1252 umlaut bytes (TM1 ASCIIOutput/TextOutput on German servers)', () => {
    // "Umsätze" with ä as the single Latin-1 byte 0xE4 — what TM1 11.8 returns.
    const buf = Buffer.from([0x55, 0x6d, 0x73, 0xe4, 0x74, 0x7a, 0x65]);
    expect(decodeServerText(buf)).toBe('Umsätze');
  });

  it('decodes the Windows-1252 euro sign (0x80, differs from ISO-8859-1)', () => {
    expect(decodeServerText(Buffer.from([0x80]))).toBe('€');
  });

  it('decodes valid UTF-8 as UTF-8 (UTF-8 / v12 servers, pure ASCII)', () => {
    expect(decodeServerText(Buffer.from('Grüße', 'utf8'))).toBe('Grüße');
    expect(decodeServerText(Buffer.from('CellPutN,P,A,1\n', 'utf8'))).toBe('CellPutN,P,A,1\n');
  });
});

describe('readFile', () => {
  it('returns body content on 200', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: 'CellPutN,P,A,1\n' });
    const r = await readFile(cfg, 'virt.log');
    expect(r.found).toBe(true);
    expect(r.content).toBe('CellPutN,P,A,1\n');
    expect(mockApi.mock.calls[0][1]).toBe(`Files('virt.log')/Content`);
  });

  it('returns found:false on 404', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' });
    const r = await readFile(cfg, 'missing.log');
    expect(r.found).toBe(false);
    expect(r.content).toBe('');
  });

  it('encodes filename with special chars', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: '' });
    await readFile(cfg, 'has space.log');
    expect(mockApi.mock.calls[0][1]).toBe(`Files('has%20space.log')/Content`);
  });

  it('throws on 500', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'boom' });
    await expect(readFile(cfg, 'x.log')).rejects.toThrow(/HTTP 500/);
  });

  it('handles empty body', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: '' });
    const r = await readFile(cfg, 'empty.log');
    expect(r.found).toBe(true);
    expect(r.content).toBe('');
  });
});

describe('deleteFile', () => {
  it('DELETEs the file', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' });
    await deleteFile(cfg, 'virt.log');
    expect(mockApi.mock.calls[0][0]).toBe('DELETE');
    expect(mockApi.mock.calls[0][1]).toBe(`Files('virt.log')`);
  });

  it('tolerates 404 (already gone)', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' });
    await expect(deleteFile(cfg, 'gone.log')).resolves.toBeUndefined();
  });

  it('throws on 500', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'boom' });
    await expect(deleteFile(cfg, 'x.log')).rejects.toThrow(/HTTP 500/);
  });
});

describe('readErrorLog / deleteErrorLog', () => {
  const mockBin = vi.mocked(apiRequestBinary);
  beforeEach(() => mockBin.mockReset());

  it('v11 reads and deletes through ErrorLogFiles', async () => {
    mockBin.mockResolvedValue({ statusCode: 200, body: Buffer.from('x') } as never);
    mockApi.mockResolvedValue({ statusCode: 204, body: '' } as never);
    const r = await readErrorLog(cfg, 'TM1ProcessError_P_output.log');
    await deleteErrorLog(cfg, 'TM1ProcessError_P_output.log');
    expect(r).toEqual({ found: true, content: 'x' });
    expect(mockBin.mock.calls[0][1]).toBe("ErrorLogFiles('TM1ProcessError_P_output.log')/Content");
    expect(mockApi.mock.calls[0].slice(0, 2)).toEqual(['DELETE', "ErrorLogFiles('TM1ProcessError_P_output.log')"]);
  });

  // v12's ErrorLogFiles lists only ProcessLog_*.jsonl — the helper's bare-name
  // file lands in the Files content space.
  it('v12 reads and deletes through Contents(Files)', async () => {
    const v12 = { ...(cfg as object), version: 'v12' } as never;
    mockBin.mockResolvedValue({ statusCode: 200, body: Buffer.from('x') } as never);
    mockApi.mockResolvedValue({ statusCode: 404, body: '' } as never);
    await readErrorLog(v12, 'TM1ProcessError_P_output.log');
    await expect(deleteErrorLog(v12, 'TM1ProcessError_P_output.log')).resolves.toBeUndefined();
    expect(mockBin.mock.calls[0][1]).toBe("Contents('Files')/Contents('TM1ProcessError_P_output.log')/Content");
    expect(mockApi.mock.calls[0][1]).toBe("Contents('Files')/Contents('TM1ProcessError_P_output.log')");
  });
});
