import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../tm1Rest/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../tm1Rest/client';
import { listApplications } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

// NOTE: mock impls read the path into a leading `const` before branching. Writing
// `if (p.endsWith(...))` as the arrow's first statement trips an esbuild/vitest
// transpile quirk in this repo where the spy passes `p` as undefined on the first
// statement (production args are verified-correct strings — see listContainer).
describe('listApplications merge', () => {
  beforeEach(() => (apiRequest as any).mockReset());
  it('merges public + private and flags isPrivate', async () => {
    (apiRequest as any).mockImplementation(async (_m: string, p: string) => {
      const priv = String(p).endsWith('/PrivateContents');
      if (priv) return { statusCode: 200, body: JSON.stringify({ value: [
        { '@odata.type': '#ibm.tm1.api.v1.Link', ID: 'pl.extr', Name: 'pl', URL: 'https://x' } ]}) };
      return { statusCode: 200, body: JSON.stringify({ value: [
        { '@odata.type': '#ibm.tm1.api.v1.Folder', ID: 'Pub', Name: 'Pub' } ]}) };
    });
    const out = await listApplications([], CFG);
    expect(out.find(e => e.name === 'Pub')?.isPrivate).toBe(false);
    expect(out.find(e => e.name === 'pl')?.isPrivate).toBe(true);
  });
  it('tolerates a missing private store (non-2xx)', async () => {
    (apiRequest as any).mockImplementation(async (_m: string, p: string) => {
      const priv = String(p).endsWith('/PrivateContents');
      if (priv) return { statusCode: 401, body: '' };
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    });
    const out = await listApplications([], CFG);
    expect(out).toEqual([]);
  });
});
