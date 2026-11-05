import { describe, it, expect, beforeEach, vi } from 'vitest';

// `viewPath` reads `window.__l10n` at module start — hence `vi.hoisted`, which
// runs before the imports. Without the map, `fmt` would only return the key,
// and the test would check that a key contains a name.
vi.hoisted(() => {
  (globalThis as unknown as { __l10n: Record<string, string> }).__l10n = {
    vwPasteNotFound: '{0} nicht gefunden: {1}',
  };
});

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({ flashBanner: vi.fn() }));

import { initialView, pushIntent, orderIsReplaced } from '../webviewClient/dimensionBrowser/intents';
import { storedMdx } from '../webviewClient/dimensionBrowser/viewMdx';
import {
  startView, onViewRows, addNames, insertNamesAt, currentMdx, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { flashBanner } from '../webviewClient/dimensionBrowser/banner';

const S = '{[aa].[aa].Members}';
let posted: { type: string; requestId?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
const zeile = (name: string) => ({
  name, caption: name, type: 'N' as const, level: 0, parent: null, ancestors: [], drilled: false,
});
function antworte(namen: string[], hasMore = false): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa',
    ok: true, rows: namen.map(zeile), cardinality: namen.length, hasMore,
  } as never);
}

/**
 * Up to here the new path could only RESTRICT: a base is replaced,
 * layers take away. ADDING something was missing (click test flameY3T1,
 * 2026-08-23: "you should be able to add the same thing again even if it
 * is already in there").
 *
 * `UNION(a, b, ALL)` appends and keeps repetitions — measured live
 * (2026-08-23, `aa`): without `ALL` it deduplicates and on `Stations` went
 * from 548 down to 241.
 */
describe('appending names', () => {
  const mit = (names: string[]) => pushIntent(initialView('tree'), { kind: 'add', names });

  it('appends them with UNION — ALL, so that repetitions stay', () => {
    expect(storedMdx(mit(['a', 'b']), 'aa', 'aa'))
      .toBe(`{UNION(${S}, {[aa].[aa].[a],[aa].[aa].[b]}, ALL)}`);
  });

  it('the same element once more then stands there TWICE', () => {
    // Exactly the request: "even if it is already in there".
    const mdx = storedMdx(mit(['a']), 'aa', 'aa');
    expect(mdx).toContain('UNION(');
    expect(mdx).toContain(', ALL)');
  });

  it('an empty list is no intention', () => {
    expect(storedMdx(mit([]), 'aa', 'aa')).toBe(S);
  });

  it('does NOT reorder the rest — the indentation stays', () => {
    // `UNION` appends at the back and does not touch the first set. The
    // appended rows stand outside their tree position and
    // appear flat — that is honest, they ARE not in the tree there.
    expect(orderIsReplaced(mit(['a']))).toBe(false);
  });
});

describe('appending on the load path', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
  });

  it('lays a layer and fetches anew', () => {
    startView('aa', 'aa', post);
    addNames(['x']);
    expect(currentMdx()).toContain('UNION(');
  });

  it('an empty list does not fetch', () => {
    startView('aa', 'aa', post);
    const n = posted.filter((p) => p.type === 'fetchViewRows').length;
    addNames([]);
    expect(posted.filter((p) => p.type === 'fetchViewRows')).toHaveLength(n);
  });
});

describe('position-exact insertion', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
  });

  it('puts the names ABOVE the clicked row', () => {
    // A hand position only survives in a hand order — in the tree
    // the hierarchy determines where something stands, and the insertion would be
    // invisible (the same lesson as in the old path, K12).
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    insertNamesAt('b', false, ['x']);
    expect(currentMdx()).toBe('{[aa].[aa].[a],[aa].[aa].[x],[aa].[aa].[b],[aa].[aa].[c]}');
  });

  it('and BELOW', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b', 'c']);
    insertNamesAt('b', true, ['x', 'y']);
    expect(currentMdx())
      .toBe('{[aa].[aa].[a],[aa].[aa].[b],[aa].[aa].[x],[aa].[aa].[y],[aa].[aa].[c]}');
  });

  it('an incomplete window is REJECTED, not half committed', () => {
    // The hand order would have to name the WHOLE set. Making an order out of a window
    // would mean silently deleting the rest.
    startView('aa', 'aa', post);
    antworte(['a', 'b'], true);
    insertNamesAt('b', false, ['x']);
    expect(currentMdx()).toBe(S);
    expect(vi.mocked(flashBanner)).toHaveBeenCalled();
  });

  it('an unknown target row changes nothing', () => {
    startView('aa', 'aa', post);
    antworte(['a', 'b']);
    insertNamesAt('gibtsnicht', false, ['x']);
    expect(currentMdx()).toBe(S);
  });
});

// ---------------------------------------------------------------------------

describe('what was not found on insertion is reported', () => {
  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    (globalThis as unknown as { document: unknown }).document = { getElementById: () => null };
    vi.mocked(flashBanner).mockClear();
  });

  it('names the names the server does not know', () => {
    // Measured live (2026-08-23): TM1 drops an unknown name SILENTLY
    // — `UNION(M, {[gibtsnicht]}, ALL)` returns `M` unchanged, without an
    // error. Without this comparison the user would only see fewer rows than
    // inserted and would not know which ones.
    startView('aa', 'aa', post);
    addNames(['a', 'gibtsnicht', 'b']);
    antworte(['a', 'b']);
    expect(vi.mocked(flashBanner).mock.calls.map((c) => String(c[0])).join(' '))
      .toContain('gibtsnicht');
  });

  it('compares WITHOUT regard to upper/lower case', () => {
    // `{[SUM]}` finds `sum` (measured live) — whoever spells the name differently
    // has still found it.
    startView('aa', 'aa', post);
    addNames(['SUM']);
    antworte(['sum']);
    expect(vi.mocked(flashBanner)).not.toHaveBeenCalled();
  });

  it('stays silent when everything is there', () => {
    startView('aa', 'aa', post);
    addNames(['a']);
    antworte(['a']);
    expect(vi.mocked(flashBanner)).not.toHaveBeenCalled();
  });

  it('stays silent on an incomplete window — then it cannot be decided', () => {
    // A missing name could stand behind the window edge. A message
    // would then be a claim about something unseen.
    startView('aa', 'aa', post);
    addNames(['a', 'weitweg']);
    antworte(['a'], true);
    expect(vi.mocked(flashBanner)).not.toHaveBeenCalled();
  });
});
