/**
 * The total-count reply of the dimension browser (`handleFetchViewCount`).
 *
 * Sister file to `dimBrowserViewRowsHandler.test.ts`, and built for the same
 * reason: since both replies run through `viewAnswer.ts#answerOrError`,
 * the shape only exists ONCE — but a bug in it then hits
 * both paths. So exactly what can silently go wrong
 * is pinned down here:
 *
 *  • The epoch stamps `dimName`/`hierName` must travel along in the error branch
 *    TOO. Without them the central guard (`MSG_SCOPE`) cannot discard a
 *    message from the OLD hierarchy (K11) — it then lands in
 *    the new display without an error showing up anywhere.
 *  • `-1` means "the server did not report a `Cardinality`", not "empty
 *    set". On `-1` the display falls back to the left number alone;
 *    a `0` would be the claim that there is nothing.
 *  • The handler does NOT THROW. An error goes back as `ok: false` along with TM1's
 *    own message.
 *  • Posting happens AFTER the `catch`, not inside it. If the post were in the `try`,
 *    a successful fetch on a panel that has since been disposed would run into the
 *    `catch` and turn into an error message — and the second post
 *    there would throw in turn.
 *
 * Both mock paths: `dimensionElementsApi` imports the transport directly from
 * `tm1Rest/client` (`no-tm1client-in-deep-layers` forbids it the facade).
 * The API layer runs FOR REAL here — only the transport is a double, so that
 * the conversion `Cardinality` → `total` is checked as well.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { handleFetchViewCount, type FetchViewCountMsg } from '../commands/dimension/viewCountHandler';

const CFG = { serverUrl: 'https://x', username: 'u', password: 'p', authType: 'basic' } as never;

const MSG: FetchViewCountMsg = {
  type: 'fetchViewCount', requestId: 7, dimName: 'Kunde', hierName: 'Regionen',
  mdx: '{[Kunde].[Regionen].Members}',
};

/** Collects the posted replies. */
function senke() {
  const posted: Array<Record<string, unknown>> = [];
  return { posted, post: (m: unknown) => { posted.push(m as Record<string, unknown>); } };
}

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

describe('handleFetchViewCount — success path', () => {
  it('posts exactly one reply with the total count and the epoch stamps', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200, body: JSON.stringify({ Cardinality: 295000, Tuples: [] }),
    } as never);
    const s = senke();

    await handleFetchViewCount(MSG, CFG, s.post);

    expect(s.posted).toEqual([{
      type: 'viewCount', requestId: 7, dimName: 'Kunde', hierName: 'Regionen',
      ok: true, total: 295000,
    }]);
  });

  it('sends the UNwindowed expression as the POST body', async () => {
    // `storedMdx`, not `fetchMdx`: the total is the count of the whole
    // set, not of the page currently visible.
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200, body: JSON.stringify({ Cardinality: 3 }),
    } as never);

    await handleFetchViewCount(MSG, CFG, senke().post);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, , body] = vi.mocked(apiRequest).mock.calls[0];
    expect(method).toBe('POST');
    expect(body).toBe(JSON.stringify({ MDX: '{[Kunde].[Regionen].Members}' }));
  });

  it('encodes a missing Cardinality as -1, not as 0 ("empty set")', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ Tuples: [] }) } as never);
    const s = senke();

    await handleFetchViewCount(MSG, CFG, s.post);

    expect(s.posted[0]).toMatchObject({ ok: true, total: -1 });
    // The difference is the content of this test: `0` would be a statement
    // about the set, `-1` is the admission of not having one.
    expect(s.posted[0].total).not.toBe(0);
  });

  it('passes a real 0 through unchanged', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ Cardinality: 0 }) } as never);
    const s = senke();
    await handleFetchViewCount(MSG, CFG, s.post);
    expect(s.posted[0]).toMatchObject({ ok: true, total: 0 });
  });
});

describe('handleFetchViewCount — error path', () => {
  it('reports TM1\'s own message as ok:false instead of throwing', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { code: '501', message: 'Syntaxfehler bei "Membrs"' } }),
    } as never);
    const s = senke();

    await expect(handleFetchViewCount(MSG, CFG, s.post)).resolves.toBeUndefined();

    expect(s.posted).toHaveLength(1);
    expect(s.posted[0]).toMatchObject({ type: 'viewCount', requestId: 7, ok: false });
    expect(s.posted[0].message).toContain('Membrs');
  });

  it('carries dimName/hierName in the error branch TOO (K11)', async () => {
    // Without the two stamps `MSG_SCOPE` cannot discard an error message from the OLD
    // hierarchy — it then appears in the new display.
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 500, body: '' } as never);
    const s = senke();

    await handleFetchViewCount(MSG, CFG, s.post);

    expect(s.posted[0]).toMatchObject({ dimName: 'Kunde', hierName: 'Regionen', ok: false });
  });

  it('carries NO total in the error branch — "unknown" is not "minus one"', async () => {
    // `-1` is the server's answer to a successful query without
    // `Cardinality`. A failed fetch has no number at all.
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 500, body: '' } as never);
    const s = senke();
    await handleFetchViewCount(MSG, CFG, s.post);
    expect(s.posted[0]).not.toHaveProperty('total');
  });

  it('falls back to "HTTP <status>" when the body is not an OData error', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 503, body: '' } as never);
    const s = senke();
    await handleFetchViewCount(MSG, CFG, s.post);
    expect(s.posted[0].message).toContain('HTTP 503');
  });

  it('also reports a transport error as ok:false', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('socket hang up'));
    const s = senke();
    await expect(handleFetchViewCount(MSG, CFG, s.post)).resolves.toBeUndefined();
    expect(s.posted[0]).toMatchObject({ ok: false, message: 'socket hang up' });
  });
});

describe('handleFetchViewCount — the order of building/posting', () => {
  it('posts AFTER the catch: a throwing post does not become an error message', async () => {
    // The `WebviewPanelHost` does not dispose the message subscription — a
    // post to a dead panel throws. If it were INSIDE the `try`, a
    // SUCCESSFUL fetch would run into the `catch`, turn into an
    // error message, and the second post there would throw in turn.
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 200, body: JSON.stringify({ Cardinality: 5 }),
    } as never);
    let aufrufe = 0;
    const post = () => { aufrufe++; throw new Error('Webview is disposed'); };

    // The throw reaches the caller — but exactly ONCE, and it comes from
    // posting, not from a success turned into an error message.
    await expect(handleFetchViewCount(MSG, CFG, post)).rejects.toThrow('Webview is disposed');
    expect(aufrufe).toBe(1);
  });
});
