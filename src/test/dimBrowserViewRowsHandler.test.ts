import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));

import { apiRequest } from '../tm1Client';
import { handleFetchViewRows, releaseMemberSet } from '../commands/dimension/viewRowsHandler';

const CFG = { serverUrl: 'https://x', username: 'u', password: 'p', authType: 'basic' } as never;
const antwort = (rows: unknown[]) => ({
  statusCode: 200,
  body: JSON.stringify({ Cardinality: rows.length, Tuples: rows }),
});

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

describe('handleFetchViewRows', () => {
  it('sends the rows back with the request\'s identifier', async () => {
    vi.mocked(apiRequest).mockResolvedValue(antwort([
      { Members: [{ Name: 'd', DisplayInfo: 65536, Parent: null, Element: { Type: 'Consolidated', Level: 1 } }] },
    ]) as never);
    const posted: unknown[] = [];

    await handleFetchViewRows(
      { type: 'fetchViewRows', requestId: 7, dimName: 'aa', hierName: 'aa', mdx: '{[aa].[aa].Members}', top: 200, chain: { kind: 'name' } },
      CFG, (m) => { posted.push(m); },
    );

    expect(posted).toEqual([{
      type: 'viewRows', requestId: 7, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [{ name: 'd', caption: 'd', type: 'C', level: 1, parent: null, ancestors: [], drilled: true }],
      hasMore: false,
    }]);
  });

  it('reports `hasMore` when one row more came back than requested', async () => {
    // The client requests `top + 1`: if the extra row arrives, there is more.
    // `cardinality` is NOT suitable for this — under a windowed
    // expression it is the window size (measured live, plan 1).
    const drei = [1, 2, 3].map((n) => ({ Members: [{ Name: `e${n}`, DisplayInfo: 0, Parent: null, Element: { Type: 'Numeric', Level: 0 } }] }));
    vi.mocked(apiRequest).mockResolvedValue(antwort(drei) as never);
    const posted: { dimName?: string; hierName?: string; rows?: unknown[]; hasMore?: boolean }[] = [];

    await handleFetchViewRows(
      { type: 'fetchViewRows', requestId: 1, dimName: 'aa', hierName: 'aa', mdx: '{…}', top: 2, chain: { kind: 'name' } },
      CFG, (m) => { posted.push(m as never); },
    );

    expect(posted[0].hasMore).toBe(true);
    expect(posted[0]).toMatchObject({ dimName: 'aa', hierName: 'aa' });
    // Not only the length, but also WHICH two (review finding M7): a `slice`
    // from the wrong end (`slice(-2)` instead of `slice(0, top)`) would otherwise
    // slip through here unnoticed.
    expect(posted[0].rows).toEqual([
      expect.objectContaining({ name: 'e1' }),
      expect.objectContaining({ name: 'e2' }),
    ]);
  });

  it('reports the error with TM1\'s own message instead of throwing', async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      statusCode: 400,
      body: JSON.stringify({ error: { code: '501', message: 'Syntaxfehler bei "Membrs"' } }),
    } as never);
    const posted: { dimName?: string; hierName?: string; ok?: boolean; message?: string }[] = [];

    await handleFetchViewRows(
      { type: 'fetchViewRows', requestId: 2, dimName: 'aa', hierName: 'aa', mdx: '{kaputt}', top: 200, chain: { kind: 'name' } },
      CFG, (m) => { posted.push(m as never); },
    );

    expect(posted[0].ok).toBe(false);
    expect(posted[0].message).toContain('Membrs');
    // The error branch carries dim/hier too (K11): otherwise the central
    // guard could not discard an error message from the OLD hierarchy.
    expect(posted[0]).toMatchObject({ dimName: 'aa', hierName: 'aa' });
  });

  it('carries the wide chain projection type from the message into the API request', async () => {
    // Without a test, a deleted `msg.chain` pass-through silently falls back to `'name'`,
    // and the indentation goes wrong without a test failure.
    vi.mocked(apiRequest).mockResolvedValue(antwort([
      { Members: [{ Name: 'e', DisplayInfo: 0, Parent: null, Element: { Type: 'Numeric', Level: 0 } }] },
    ]) as never);
    const posted: unknown[] = [];

    await handleFetchViewRows(
      { type: 'fetchViewRows', requestId: 3, dimName: 'aa', hierName: 'aa', mdx: '{[aa].[aa].Members}', top: 100, chain: { kind: 'name+element' } },
      CFG, (m) => { posted.push(m); },
    );

    // The key to the finding: the apiRequest call must carry the wide
    // projection — `Parent($select=Name;$expand=Element(` is only in the
    // query string with `chain: { kind: 'name+element' }` (parameter 1, apiPath).
    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls.length).toBe(1);
    const apiPath = calls[0]?.[1] as string | undefined;
    expect(apiPath).toContain('Parent($select=Name;$expand=Element(');
  });
});

describe('handleFetchViewRows over a stored set (MemberSets)', () => {
  const row = (n: string) => ({ Members: [{ Name: n, DisplayInfo: 0, Parent: null, Element: { Type: 'Numeric', Level: 0 } }] });
  const created = (ordinal: number, names: string[]) => ({
    statusCode: 201, body: JSON.stringify({ Ordinal: ordinal, Cardinality: 99, Tuples: names.map(row) }),
  });
  const page = (names: string[]) => ({ statusCode: 200, body: JSON.stringify({ value: names.map(row) }) });
  const msg = (setMdx: string, skip: number) => ({
    type: 'fetchViewRows' as const, requestId: 1, dimName: 'aa', hierName: 'aa',
    mdx: `{SUBSET(${setMdx}, ${skip}, 3)}`, top: 2, chain: { kind: 'name' as const }, page: { setMdx, skip },
  });
  const calls = () => vi.mocked(apiRequest).mock.calls.map((c) => `${c[0]} ${String(c[1]).split('?')[0]}`);
  const names = (posted: unknown[]) => (posted[0] as { rows: { name: string }[] }).rows.map((r) => r.name);

  it('creates the set on the first window and pages it afterwards', async () => {
    const owner = {};
    vi.mocked(apiRequest).mockResolvedValueOnce(created(5, ['a', 'b', 'c']) as never).mockResolvedValueOnce(page(['c', 'd']) as never);
    await handleFetchViewRows(msg('{X}', 0), CFG, () => {}, owner);
    const posted: unknown[] = [];
    await handleFetchViewRows(msg('{X}', 2), CFG, (m) => { posted.push(m); }, owner);
    expect(calls()).toEqual(['POST ExecuteMDXSetExpression', 'GET MemberSets(5)/Tuples']);
    // The first window asks top + 1 rows; the stored set gets the UNwindowed expression.
    expect(String(vi.mocked(apiRequest).mock.calls[0]?.[1])).toContain('$select=Ordinal,Cardinality&$expand=Tuples($top=3;');
    expect(vi.mocked(apiRequest).mock.calls[0]?.[2]).toBe(JSON.stringify({ MDX: '{X}' }));
    expect(String(vi.mocked(apiRequest).mock.calls[1]?.[1])).toContain('$skip=2&$top=3&$expand=Members(');
    expect(names(posted)).toEqual(['c', 'd']);
  });

  it('falls back to the windowed expression when the stored set is gone (404)', async () => {
    const owner = {};
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(created(5, ['a', 'b', 'c']) as never)
      .mockResolvedValueOnce({ statusCode: 404, body: '' } as never)
      .mockResolvedValueOnce(antwort([row('c')]) as never);
    await handleFetchViewRows(msg('{X}', 0), CFG, () => {}, owner);
    const posted: unknown[] = [];
    await handleFetchViewRows(msg('{X}', 2), CFG, (m) => { posted.push(m); }, owner);
    expect(calls()).toEqual(['POST ExecuteMDXSetExpression', 'GET MemberSets(5)/Tuples', 'POST ExecuteMDXSetExpression']);
    expect(vi.mocked(apiRequest).mock.calls[2]?.[2]).toBe(JSON.stringify({ MDX: '{SUBSET({X}, 2, 3)}' }));
    expect(names(posted)).toEqual(['c']);
  });

  it('frees the old set on a new view and on a view without paging', async () => {
    const owner = {};
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(created(5, ['a']) as never)
      .mockResolvedValueOnce({ statusCode: 204, body: '' } as never)
      .mockResolvedValueOnce(created(6, ['b']) as never)
      .mockResolvedValueOnce({ statusCode: 204, body: '' } as never)
      .mockResolvedValueOnce(antwort([row('t')]) as never);
    await handleFetchViewRows(msg('{X}', 0), CFG, () => {}, owner);
    await handleFetchViewRows(msg('{Y}', 0), CFG, () => {}, owner);
    const { page: _drop, ...tree } = msg('{T}', 0);
    await handleFetchViewRows(tree, CFG, () => {}, owner);
    expect(calls()).toEqual([
      'POST ExecuteMDXSetExpression', 'DELETE MemberSets(5)', 'POST ExecuteMDXSetExpression',
      'DELETE MemberSets(6)', 'POST ExecuteMDXSetExpression',
    ]);
  });

  it('a creation that finishes after the panel let go frees its own set', async () => {
    const owner = {};
    let finish: (v: unknown) => void = () => {};
    vi.mocked(apiRequest)
      .mockReturnValueOnce(new Promise((r) => { finish = r; }) as never)
      .mockResolvedValue({ statusCode: 204, body: '' } as never);
    const pending = handleFetchViewRows(msg('{X}', 0), CFG, () => {}, owner);
    releaseMemberSet(owner, CFG);
    finish(created(7, ['a']));
    await pending;
    await Promise.resolve();
    expect(calls()).toEqual(['POST ExecuteMDXSetExpression', 'DELETE MemberSets(7)']);
  });
});
