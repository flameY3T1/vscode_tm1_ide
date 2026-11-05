import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Rest/client', async (orig) => {
  const actual = await orig<any>();
  return {
    ...actual,
    apiRequestBinary: vi.fn(async () => ({ statusCode: 200, body: Buffer.from('PK') })),
  };
});

import { getDocumentContent } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };
import { apiRequestBinary } from '../tm1Rest/client';

describe('getDocumentContent', () => {
  beforeEach(() => (apiRequestBinary as any).mockClear());

  it('hits /Document/Content on the public container', async () => {
    const buf = await getDocumentContent(['DemoApp'], 'Portal.xlsx.blob', false, CFG);
    expect(buf.toString()).toBe('PK');
    expect((apiRequestBinary as any).mock.calls[0][1]).toBe(
      "Contents('Applications')/Contents('DemoApp')/Contents('Portal.xlsx.blob')/Document/Content",
    );
  });

  it('uses PrivateContents when isPrivate', async () => {
    await getDocumentContent(['DemoApp'], 'x.blob', true, CFG);
    expect((apiRequestBinary as any).mock.calls[0][1]).toBe(
      "Contents('Applications')/Contents('DemoApp')/PrivateContents('x.blob')/Document/Content",
    );
  });

  it('throws on non-2xx', async () => {
    (apiRequestBinary as any).mockResolvedValueOnce({ statusCode: 404, body: Buffer.from('') });
    await expect(getDocumentContent([], 'nope.blob', false, CFG)).rejects.toThrow();
  });
});
