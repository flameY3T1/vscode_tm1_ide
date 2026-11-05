// One reference to a deleted object fails the expanded folder list as a whole
// (`400 Code 42 "Unable to resolve cube reference."`, live 11.8, 2026-09-28).
// The walk must fall back to the plain list and resolve each target on its own.
import { describe, it, expect, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../tm1Rest/client', () => ({ apiRequest, apiRequestBinary: vi.fn() }));

import { walkApplications } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = { serverUrl: 'http://tm1:8001' } as unknown as Tm1Config;
const ok = (body: unknown) => ({ statusCode: 200, body: JSON.stringify(body) });
const CUBE_REF = '#ibm.tm1.api.v1.CubeReference';
const PROC_REF = '#ibm.tm1.api.v1.ProcessReference';

describe('walkApplications — broken reference in a folder', () => {
  it('keeps the folder, marks only the dead reference as broken', async () => {
    apiRequest.mockImplementation(async (_m: string, path: string) => {
      if (path.includes('PrivateContents')) { return ok({ value: [] }); }
      if (path.includes('?$expand=tm1.')) {
        return { statusCode: 400, body: '{"error":{"code":"42","message":"Unable to resolve cube reference."}}' };
      }
      if (path.includes("('cref.cube')")) { return { statusCode: 400, body: '{}' }; }
      if (path.includes("('pref.process')")) {
        return ok({ '@odata.type': PROC_REF, ID: 'pref.process', Name: 'pref', Process: { Name: 'P1' } });
      }
      return ok({ value: [
        { '@odata.type': CUBE_REF, ID: 'cref.cube', Name: 'cref' },
        { '@odata.type': PROC_REF, ID: 'pref.process', Name: 'pref' },
      ] });
    });
    const out = await walkApplications(CFG);
    expect(out.map((e) => [e.name, !!e.broken, e.target])).toEqual([
      ['cref', true, { cubeName: undefined }],
      ['pref', false, { processName: 'P1' }],
    ]);
    expect(apiRequest.mock.calls.map((c) => c[1])).toContain(
      "Contents('Applications')/Contents('pref.process')?$expand=Process($select=Name)");
  });
});
