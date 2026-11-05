import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn(), apiRequestBinary: vi.fn() }));
import { apiRequest, apiRequestBinary } from '../tm1Rest/client';
import { uploadDocument, createReference } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

describe('uploadDocument (2-step: POST entry → PUT stream)', () => {
  beforeEach(() => {
    (apiRequest as any).mockReset();
    (apiRequestBinary as any).mockReset();
  });

  it('POSTs a Document entry then PUTs raw bytes to /Document/Content', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: JSON.stringify({ ID: 'Report.xlsx.blob' }) });
    (apiRequestBinary as any).mockResolvedValue({ statusCode: 204, body: Buffer.alloc(0) });

    const bytes = Buffer.from('PKxx');
    await uploadDocument(['DemoApp'], 'Report.xlsx', bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false, CFG);

    // Step A: POST entry via JSON
    const [method, p, body, , , headers] = (apiRequest as any).mock.calls[0];
    expect(method).toBe('POST');
    expect(p).toBe("Contents('Applications')/Contents('DemoApp')/Contents");
    expect(JSON.parse(body)).toEqual({ '@odata.type': '#ibm.tm1.api.v1.Document', Name: 'Report.xlsx' });
    expect(headers['Content-Type']).toBe('application/json');

    // Step B: PUT raw bytes to the ID from the POST response
    const [pmethod, ppath, pbody, , pheaders] = (apiRequestBinary as any).mock.calls[0];
    expect(pmethod).toBe('PUT');
    expect(ppath).toBe("Contents('Applications')/Contents('DemoApp')/Contents('Report.xlsx.blob')/Document/Content");
    expect(Buffer.isBuffer(pbody)).toBe(true);
    expect(pbody).toBe(bytes);
    expect(pheaders['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  it('falls back to <name>.blob id when POST response lacks ID', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    (apiRequestBinary as any).mockResolvedValue({ statusCode: 204, body: Buffer.alloc(0) });
    await uploadDocument([], 'a.txt', Buffer.from('x'), 'text/plain', false, CFG);
    const ppath = (apiRequestBinary as any).mock.calls[0][1];
    expect(ppath).toBe("Contents('Applications')/Contents('a.txt.blob')/Document/Content");
  });

  it('uploads into PrivateContents when private', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: JSON.stringify({ ID: 'p.txt.blob' }) });
    (apiRequestBinary as any).mockResolvedValue({ statusCode: 204, body: Buffer.alloc(0) });
    await uploadDocument([], 'p.txt', Buffer.from('x'), 'text/plain', true, CFG);
    expect((apiRequest as any).mock.calls[0][1]).toBe("Contents('Applications')/PrivateContents");
    expect((apiRequestBinary as any).mock.calls[0][1])
      .toBe("Contents('Applications')/PrivateContents('p.txt.blob')/Document/Content");
  });

  it('throws when the entry POST fails', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 400, body: 'boom' });
    await expect(uploadDocument([], 'a.txt', Buffer.from('x'), 'text/plain', false, CFG)).rejects.toThrow();
    expect((apiRequestBinary as any)).not.toHaveBeenCalled();
  });

  it('throws when the content PUT fails', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: JSON.stringify({ ID: 'a.txt.blob' }) });
    (apiRequestBinary as any).mockResolvedValue({ statusCode: 500, body: Buffer.alloc(0) });
    await expect(uploadDocument([], 'a.txt', Buffer.from('x'), 'text/plain', false, CFG)).rejects.toThrow();
  });
});

describe('createReference', () => {
  beforeEach(() => (apiRequest as any).mockReset());

  it('POSTs a CubeReference with Cube@odata.bind', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await createReference(['DemoApp'], 'Sales', 'Cube', "Cubes('Sales')", false, CFG);
    const [method, p, body, , , headers] = (apiRequest as any).mock.calls[0];
    expect(method).toBe('POST');
    expect(p).toBe("Contents('Applications')/Contents('DemoApp')/Contents");
    expect(JSON.parse(body)).toEqual({
      '@odata.type': '#ibm.tm1.api.v1.CubeReference',
      Name: 'Sales',
      'Cube@odata.bind': "Cubes('Sales')",
    });
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('builds each reference type body shape', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    const cases: Array<[any, string]> = [
      ['View', "Cubes('C')/Views('V')"],
      ['Dimension', "Dimensions('D')"],
      ['Subset', "Dimensions('D')/Hierarchies('H')/Subsets('S')"],
      ['Process', "Processes('P')"],
      ['Chore', "Chores('C')"],
    ];
    for (const [refType, bind] of cases) {
      (apiRequest as any).mockClear();
      await createReference([], 'X', refType, bind, false, CFG);
      const body = JSON.parse((apiRequest as any).mock.calls[0][2]);
      expect(body['@odata.type']).toBe(`#ibm.tm1.api.v1.${refType}Reference`);
      expect(body.Name).toBe('X');
      expect(body[`${refType}@odata.bind`]).toBe(bind);
    }
  });

  it('POSTs into PrivateContents when private', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await createReference([], 'D', 'Dimension', "Dimensions('D')", true, CFG);
    expect((apiRequest as any).mock.calls[0][1]).toBe("Contents('Applications')/PrivateContents");
  });

  it('throws on non-2xx', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 400, body: 'nope' });
    await expect(createReference([], 'D', 'Dimension', "Dimensions('D')", false, CFG)).rejects.toThrow();
  });
});
