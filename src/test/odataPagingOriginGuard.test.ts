// src/test/odataPagingOriginGuard.test.ts
//
// Regression guard for the cross-origin `@odata.nextLink` finding (review
// 2026-08-05): the server picks the next URL, `apiRequest` forwards anything
// starting with `http` verbatim, and the transport attaches the TM1 session
// cookie / the `Basic`|`CAMNamespace` `Authorization` header (which carries the
// base64-encoded password) to it. A link pointing at another host would
// therefore hand TM1 credentials to that host.
//
// The mocked `apiRequest` doubles as the assertion surface: whatever URL the
// pagination loop would have sent credentials to shows up in its call list, so
// "did NOT request the attacker URL" is directly checkable.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', async () => await import('../tm1Rest/client'));

vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn((res: { statusCode: number; body: string }, ctx?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = ctx ? `${ctx}: ` : '';
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${res.body}`);
    }
  }),
}));

import { apiRequest } from '../tm1Rest/client';
import { fetchAllPages, assertSameOriginLink } from '../tm1Rest/odataPaging';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CFG = {
  serverUrl: 'http://tm1host:8010',
  username: 'u',
  password: 'p',
  authType: 'Basic',
  rejectUnauthorized: true,
} as unknown as Tm1Config;

const CFG_TLS = { ...CFG, serverUrl: 'https://tm1host:8010' } as unknown as Tm1Config;

const CFG_V12 = {
  ...CFG,
  serverUrl: 'https://tm1host',
  version: 'v12',
  v12: { instance: 'tm1', database: 'tm1_v12_test' },
} as unknown as Tm1Config;

/** One page body; `next` omitted → last page. */
function page(names: string[], next?: string): { statusCode: number; body: string } {
  const env: Record<string, unknown> = { value: names.map((Name) => ({ Name })) };
  if (next !== undefined) { env['@odata.nextLink'] = next; }
  return { statusCode: 200, body: JSON.stringify(env) };
}

/** URLs the loop actually issued a credentialed request to. */
function requestedUrls(): string[] {
  return vi.mocked(apiRequest).mock.calls.map((c) => c[1] as string);
}

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
});

describe('fetchAllPages — legitimate links still work', () => {
  it('follows a relative nextLink and accumulates every page', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], "Dimensions('d')/Elements?$skip=1"))
      .mockResolvedValueOnce(page(['b']));

    const rows = await fetchAllPages<{ Name: string }>("Dimensions('d')/Elements", CFG);

    expect(rows.map((r) => r.Name)).toEqual(['a', 'b']);
    expect(requestedUrls()).toEqual([
      "Dimensions('d')/Elements",
      "Dimensions('d')/Elements?$skip=1",
    ]);
  });

  it('follows an absolute nextLink pointing at the configured origin', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://tm1host:8010/api/v1/Elements?$skip=1'))
      .mockResolvedValueOnce(page(['b']));

    const rows = await fetchAllPages<{ Name: string }>('Elements', CFG);

    expect(rows.map((r) => r.Name)).toEqual(['a', 'b']);
  });

  it('accepts the explicit default port for the scheme (:80 === no port)', async () => {
    const cfg80 = { ...CFG, serverUrl: 'http://tm1host' } as unknown as Tm1Config;
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://tm1host:80/api/v1/Elements?$skip=1'))
      .mockResolvedValueOnce(page(['b']));

    await expect(fetchAllPages<{ Name: string }>('Elements', cfg80)).resolves.toHaveLength(2);
  });

  it('accepts an absolute same-origin link on a v12 base URL', async () => {
    // v12 roots data calls under /{instance}/api/v1/Databases('db') — the guard
    // must compare origins, not the path prefix, or every v12 page-2 breaks.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], "https://tm1host/tm1/api/v1/Databases('tm1_v12_test')/Dimensions?$skip=1"))
      .mockResolvedValueOnce(page(['b']));

    await expect(fetchAllPages<{ Name: string }>('Dimensions', CFG_V12)).resolves.toHaveLength(2);
  });

  it('stops normally when the last page carries no nextLink', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(page(['only']));
    await expect(fetchAllPages<{ Name: string }>('Elements', CFG)).resolves.toHaveLength(1);
    expect(requestedUrls()).toHaveLength(1);
  });
});

describe('fetchAllPages — cross-origin nextLink is rejected', () => {
  it('throws and never requests a foreign host', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'https://attacker.example/api/v1/Elements?$skip=1'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/cross-origin OData pagination link/i);

    expect(requestedUrls()).toEqual(['Elements']);
    expect(requestedUrls().join(' ')).not.toContain('attacker.example');
  });

  it('names both origins so a reverse-proxy misconfiguration is diagnosable', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://internal-tm1:8010/api/v1/Elements?$skip=1'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/http:\/\/internal-tm1:8010.*http:\/\/tm1host:8010/);
  });

  it('rejects a different port on the same host', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://tm1host:9999/api/v1/Elements?$skip=1'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/cross-origin/i);
  });

  it('rejects a scheme downgrade (https server, http link)', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://tm1host:8010/api/v1/Elements?$skip=1'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG_TLS))
      .rejects.toThrow(/cross-origin/i);
  });

  it('rejects the userinfo trick (host looks configured, authority is not)', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'http://tm1host:8010@attacker.example/api/v1/Elements'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/cross-origin/i);
    expect(requestedUrls().join(' ')).not.toContain('attacker.example');
  });

  it('rejects a protocol-relative link', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], '//attacker.example/api/v1/Elements'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/cross-origin/i);
  });

  it('rejects a non-HTTP scheme', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a'], 'file:///etc/passwd'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/non-HTTP scheme/i);
  });

  it('throws in soft mode too — a cut run must not look like "collection ended"', async () => {
    // No `label` → soft mode, which otherwise returns what it has on trouble.
    // A cross-origin link must not degrade into a plausible-looking short list.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['a', 'b'], 'https://attacker.example/next'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG, {}))
      .rejects.toThrow(/cross-origin/i);
  });

  it('rejects a foreign first URL as well', async () => {
    await expect(fetchAllPages<{ Name: string }>('https://attacker.example/api/v1/Elements', CFG))
      .rejects.toThrow(/cross-origin/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('fetchAllPages — loop and page limits', () => {
  it('throws when the server echoes the page it was just asked for', async () => {
    vi.mocked(apiRequest).mockResolvedValue(page(['a'], 'Elements'));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/looping/i);
    expect(requestedUrls()).toHaveLength(1);
  });

  it('throws instead of paging forever when links never repeat', async () => {
    let n = 0;
    vi.mocked(apiRequest).mockImplementation(async () => page(['x'], `Elements?$skip=${++n}`));

    await expect(fetchAllPages<{ Name: string }>('Elements', CFG))
      .rejects.toThrow(/did not terminate: more than 10000 pages/i);
  });

  it('honours the row limit without tripping the page cap', async () => {
    vi.mocked(apiRequest).mockResolvedValue(page(['x', 'y'], 'Elements?$skip=next'));

    const rows = await fetchAllPages<{ Name: string }>('Elements', CFG, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(requestedUrls()).toHaveLength(1);
  });

  it('does not fail a satisfied limit run over a link it would never follow', async () => {
    // The slice is complete, so the run is truncated by request, not silently.
    // Judging the unfollowed link here would turn a correct result into a throw.
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(page(['x', 'y'], 'https://attacker.example/next'));

    const rows = await fetchAllPages<{ Name: string }>('Elements', CFG, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(requestedUrls()).toEqual(['Elements']);
  });
});

describe('assertSameOriginLink', () => {
  it('passes relative links unchanged', () => {
    expect(() => assertSameOriginLink("Dimensions('d')/Elements?$skip=5", CFG)).not.toThrow();
  });

  it('passes an absolute link on the configured origin', () => {
    expect(() => assertSameOriginLink('http://tm1host:8010/api/v1/Cubes', CFG)).not.toThrow();
  });

  it('is case-insensitive about scheme and host, as URL parsing is', () => {
    expect(() => assertSameOriginLink('HTTP://TM1HOST:8010/api/v1/Cubes', CFG)).not.toThrow();
  });

  it('rejects a foreign origin', () => {
    expect(() => assertSameOriginLink('http://evil.example/api/v1/Cubes', CFG))
      .toThrow(/cross-origin/i);
  });

  it('blames the configured server URL, not the link, when the base is unusable', () => {
    // WHATWG parses `tm1host:8010` as scheme `tm1host:` — it does not throw, it
    // just yields something with no comparable origin.
    const broken = { ...CFG, serverUrl: 'tm1host:8010' } as unknown as Tm1Config;
    expect(() => assertSameOriginLink('http://tm1host:8010/api/v1/Cubes', broken))
      .toThrow(/configured server URL has no http\(s\) scheme/i);
  });

  it('does not need a parsable config for a bare relative path', () => {
    // Relative links are base-prefixed by `apiRequest`, i.e. same-origin by
    // construction — checking them would make the guard fail on call sites that
    // legitimately never resolve a base (see mdxViewSupport.test.ts).
    expect(() => assertSameOriginLink('Cubes?$select=Name', undefined as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The three loops that page by hand instead of going through `fetchAllPages`.
//
// Each one is covered separately because each swallows failures differently,
// and "does not follow the link" is only half the contract — what the caller
// sees afterwards is the other half. The mocked `apiRequest` is again the
// assertion surface: a foreign URL must never appear in its call list.
// ---------------------------------------------------------------------------

const ATTACKER = 'http://evil.example/api/v1/Elements?$skip=1';

describe('hand-rolled nextLink loops honour the origin guard', () => {
  describe('tm1Rest/subsetApi — listSubsetElementNames', () => {
    it('throws and never requests the foreign host', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce(page(['a'], ATTACKER));
      const { listSubsetElementNames } = await import('../tm1Rest/subsetApi');

      await expect(listSubsetElementNames(CFG, 'd', 'd', 's', false)).rejects.toThrow(/cross-origin/i);
      expect(requestedUrls().some((u) => u.includes('evil.example'))).toBe(false);
    });

    it('still follows a same-origin link to the end', async () => {
      vi.mocked(apiRequest)
        .mockResolvedValueOnce(page(['a'], 'http://tm1host:8010/api/v1/Elements?$skip=1'))
        .mockResolvedValueOnce(page(['b']));
      const { listSubsetElementNames } = await import('../tm1Rest/subsetApi');

      await expect(listSubsetElementNames(CFG, 'd', 'd', 's', false))
        .resolves.toEqual({ elements: ['a', 'b'], complete: true });
    });
  });

  describe('mdx/mdxSchemaCache — getDimElements', () => {
    it('re-throws instead of returning a silently truncated element set', async () => {
      // The catch-all in this loop returns partial results for ordinary
      // failures. If it also swallowed the refusal, page 1 would look like the
      // whole dimension and the MDX validator would flag every later element as
      // unknown — a wrong lint with no visible cause.
      const { getDimElements, _clearAllForTest } = await import('../mdx/mdxSchemaCache');
      _clearAllForTest();
      const api = vi.fn().mockResolvedValue(page(['a'], ATTACKER));

      await expect(getDimElements('d', CFG, api)).rejects.toThrow(/cross-origin/i);
      expect(api.mock.calls.some((c) => String(c[1]).includes('evil.example'))).toBe(false);
    });

    it('degrades an ordinary parse failure to "unreadable" instead of throwing', async () => {
      // Guards the distinction the re-throw relies on: only the origin refusal
      // escapes. Everything else degrades — since 2026-10-02 to `null`
      // ("no verdict"), not to the partial list, which flagged valid MDX.
      const { getDimElements, _clearAllForTest } = await import('../mdx/mdxSchemaCache');
      _clearAllForTest();
      const api = vi.fn()
        .mockResolvedValueOnce(page(['a'], 'Elements?$skip=1'))
        .mockResolvedValueOnce({ statusCode: 200, body: '{ not json' });

      await expect(getDimElements('d', CFG, api)).resolves.toBeNull();
    });
  });

  describe('commands/cubeViewer/alias — fetchDimAliasValues', () => {
    it('does not request the foreign host and keeps its never-throws contract', async () => {
      // This helper promises the viewer that alias lookup can never break it,
      // so the refusal is swallowed here on purpose — but the link must still
      // not be followed, and `logBestEffort` keeps the refusal visible.
      vi.mocked(apiRequest).mockResolvedValueOnce({
        statusCode: 200,
        body: JSON.stringify({
          value: [{ Name: 'e1', Attributes: { Alias: 'A1' } }],
          '@odata.nextLink': ATTACKER,
        }),
      });
      const { fetchDimAliasValues } = await import('../commands/cubeViewer/alias');

      await expect(fetchDimAliasValues('d', 'Alias', CFG)).resolves.toEqual({});
      expect(requestedUrls().some((u) => u.includes('evil.example'))).toBe(false);
    });
  });
});
