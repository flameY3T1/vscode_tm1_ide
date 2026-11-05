import { describe, it, expect, vi, beforeEach } from 'vitest';

// Review 2026-10-03, A4: the module aliased the quote-only escape as `encKey`,
// so a dimension or element with `#`, `%` or `?` cut the URL and the
// `@odata.bind` path short.
const apiRequest = vi.hoisted(() => vi.fn());
vi.mock('../tm1Rest/client', () => ({ apiRequest, assertOk: () => undefined }));
vi.mock('../tm1Rest/dimensionApi', () => ({ listElementAttributes: async () => [] }));

import { writeElementFormats } from '../tm1Rest/elementFormatApi';
import type { Tm1Config } from '../tm1Rest/transport/types';

const cfg = { serverUrl: 'http://x', username: 'u', password: 'p', rejectUnauthorized: false } as Tm1Config;

beforeEach(() => { apiRequest.mockReset(); apiRequest.mockResolvedValue({ statusCode: 200, body: '' }); });

describe('writeElementFormats — keys in paths and binds', () => {
  it('URL-encodes dimension and element names', async () => {
    await writeElementFormats(cfg, "Kto #1", { "A%'b?": 'b:0.00' });
    const [create, update] = apiRequest.mock.calls;
    expect(create[1]).toBe("Dimensions('Kto%20%231')/Hierarchies('Kto%20%231')/ElementAttributes");
    expect(update[1]).toBe("Cubes('%7DElementAttributes_Kto%20%231')/tm1.Update");
    const bind = JSON.parse(update[2])[0].Cells[0]['Tuple@odata.bind'][0];
    expect(bind).toBe("Dimensions('Kto%20%231')/Hierarchies('Kto%20%231')/Elements('A%25''b%3F')");
  });
});
