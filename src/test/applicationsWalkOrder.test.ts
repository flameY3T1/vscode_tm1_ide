// The walk loads sibling folders in parallel; the result must still come back
// in tree order (folder entries, then each sub-folder depth-first), whatever
// order the answers arrive in.
import { describe, it, expect, vi } from 'vitest';

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../tm1Rest/client', () => ({ apiRequest, apiRequestBinary: vi.fn() }));

import { walkApplications } from '../tm1Rest/applicationsApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = { serverUrl: 'http://tm1:8001' } as unknown as Tm1Config;
const FOLDER = '#ibm.tm1.api.v1.Folder';
const LINK = '#ibm.tm1.api.v1.Link';

describe('walkApplications — parallel, but in tree order', () => {
  it('keeps depth-first order although the first folder answers last', async () => {
    let inFlight = 0;
    let peak = 0;
    apiRequest.mockImplementation(async (_m: string, path: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      // Folder A is slow, B fast: a naive push-on-arrival would put B first.
      await new Promise(r => setTimeout(r, path.includes("Contents('A')") ? 20 : 1));
      inFlight--;
      const value = path.includes('PrivateContents') ? []
        : path.includes("Contents('A')") ? [{ '@odata.type': LINK, ID: 'a1', Name: 'a1' }]
        : path.includes("Contents('B')") ? [{ '@odata.type': LINK, ID: 'b1', Name: 'b1' }]
        : [{ '@odata.type': FOLDER, ID: 'A', Name: 'A' }, { '@odata.type': FOLDER, ID: 'B', Name: 'B' }];
      return { statusCode: 200, body: JSON.stringify({ value }) };
    });

    const out = await walkApplications(CFG);

    expect(out.map(e => e.name)).toEqual(['A', 'B', 'a1', 'b1']);
    expect(peak).toBeGreaterThan(1);
  });
});
