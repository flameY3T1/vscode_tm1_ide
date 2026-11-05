import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../tm1Rest/client';
import { createFolder, createLink, deleteApplication, moveApplication } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

describe('applications CRUD', () => {
  beforeEach(() => (apiRequest as any).mockReset());

  it('createFolder POSTs a Folder type to the right collection', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await createFolder(['DemoApp'], 'New', false, CFG);
    const [method, p, body, , , headers] = (apiRequest as any).mock.calls[0];
    expect(method).toBe('POST');
    expect(p).toBe("Contents('Applications')/Contents('DemoApp')/Contents");
    expect(JSON.parse(body)).toEqual({ '@odata.type': '#ibm.tm1.api.v1.Folder', Name: 'New' });
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('createLink POSTs a Link type + URL', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await createLink([], 'L', 'https://x', false, CFG);
    const body = JSON.parse((apiRequest as any).mock.calls[0][2]);
    expect(body).toEqual({ '@odata.type': '#ibm.tm1.api.v1.Link', Name: 'L', URL: 'https://x' });
  });

  it('deleteApplication DELETEs by id on the private container', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 204, body: '' });
    await deleteApplication(['DemoApp'], 'x.blob', true, CFG);
    const [method, p] = (apiRequest as any).mock.calls[0];
    expect(method).toBe('DELETE');
    expect(p).toBe("Contents('Applications')/Contents('DemoApp')/PrivateContents('x.blob')");
  });

  it('moveApplication rename POSTs tm1.Move with Name only', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await moveApplication(['DemoApp'], 'x.blob', false, { name: 'y.txt' }, CFG);
    const [method, p, body, , , headers] = (apiRequest as any).mock.calls[0];
    expect(method).toBe('POST');
    expect(p).toBe("Contents('Applications')/Contents('DemoApp')/Contents('x.blob')/tm1.Move");
    expect(JSON.parse(body)).toEqual({ Name: 'y.txt' });
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('moveApplication move builds Target@odata.bind to the destination folder', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await moveApplication(['A'], 'x.blob', false, { targetFolderPath: ['B', 'C'] }, CFG);
    const body = JSON.parse((apiRequest as any).mock.calls[0][2]);
    expect(body).toEqual({ 'Target@odata.bind': "Contents('Applications')/Contents('B')/Contents('C')" });
  });

  it('moveApplication to root binds Target to Applications; move+rename combine', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await moveApplication(['A'], 'x.blob', true, { targetFolderPath: [], name: 'z.txt' }, CFG);
    const [, p, body] = (apiRequest as any).mock.calls[0];
    expect(p).toBe("Contents('Applications')/Contents('A')/PrivateContents('x.blob')/tm1.Move");
    expect(JSON.parse(body)).toEqual({ 'Target@odata.bind': "Contents('Applications')", Name: 'z.txt' });
  });

  it('moveApplication makePrivate POSTs tm1.Move with Private flag only', async () => {
    (apiRequest as any).mockResolvedValue({ statusCode: 201, body: '{}' });
    await moveApplication(['A'], 'x.blob', false, { makePrivate: true }, CFG);
    const [, p, body] = (apiRequest as any).mock.calls[0];
    expect(p).toBe("Contents('Applications')/Contents('A')/Contents('x.blob')/tm1.Move");
    expect(JSON.parse(body)).toEqual({ Private: true });
  });
});
