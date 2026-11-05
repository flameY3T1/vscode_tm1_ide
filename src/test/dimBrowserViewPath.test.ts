import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startView, onViewRows, currentRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

vi.mock('../webviewClient/dimensionBrowser/banner', () => ({
  flashBanner: vi.fn(),
}));

const zeile = (name: string, ancestors: string[] = [], drilled = false) => ({
  name,
  caption: name,
  type: drilled ? 'C' : 'N',
  level: drilled ? 1 : 0,
  parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
  // Only the names count for deriving the depth — type/level per ancestor are
  // inconsequential filler values here (real values only with `chain: 'name+element'`).
  ancestors: ancestors.map((n) => ({ name: n, type: 'N' as const, level: 0 })),
  drilled,
});

let posted: { type: string; requestId?: number; dimName?: string; hierName?: string; mdx?: string; top?: number }[] = [];
const post = (m: unknown) => { posted.push(m as never); };
/**
 * Task 3: since the counter, `fetchRows()` ADDITIONALLY posts `fetchViewCount` next to
 * `fetchViewRows`. These tests check only the row behaviour.
 */
const rowPosted = () => posted.filter((p) => p.type === 'fetchViewRows');

beforeEach(() => {
  posted = [];
  _resetViewPathForTest();
  // Since Task 3, `onViewRows` draws at the end (`drawView()`) — this test
  // checks the state, not the drawing, but needs a `document`,
  // otherwise `drawView` breaks at `document.getElementById`.
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: () => null,
  };
});

describe('viewPath', () => {
  it('requests the tree expression on start', () => {
    startView('aa', 'aa', post);
    expect(rowPosted()).toHaveLength(1);
    expect(posted[0].type).toBe('fetchViewRows');
    expect(posted[0].mdx).toContain('[aa].[aa].Members');
  });

  it('fetches one row more than it shows', () => {
    startView('aa', 'aa', post);
    expect(posted[0].mdx).toContain(`, ${posted[0].top! + 1})`);
  });

  it('takes over the rows of the response', () => {
    startView('aa', 'aa', post);
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [zeile('sum', [], true), zeile('a', ['sum'])], hasMore: false,
    } as never);
    expect(currentRows().map((r) => `${r.depth}:${r.name}`)).toEqual(['0:sum', '1:a']);
  });

  it('discards a response to a SUPERSEDED request', () => {
    startView('aa', 'aa', post);
    const alt = posted[0].requestId!;
    startView('aa', 'aa', post);
    // second request
    onViewRows({
      type: 'viewRows', requestId: alt, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [zeile('veraltet')], hasMore: false,
    } as never);
    expect(currentRows()).toEqual([]);
  });

  it('names dimension and hierarchy in the request', () => {
    // So that the CENTRAL guard (`MSG_SCOPE`) can discard the response on a
    // hierarchy switch — `drillAncestors` does it the same way.
    // The client builds NO check of its own for this.
    startView('aa', 'aa', post);
    expect(posted[0]).toMatchObject({ dimName: 'aa', hierName: 'aa' });
  });

  it('keeps the old rows on an error and reports the reason', async () => {

    const { flashBanner } = await import('../webviewClient/dimensionBrowser/banner');
    const flashBannerMock = vi.mocked(flashBanner);
    startView('aa', 'aa', post);
    onViewRows({
      type: 'viewRows', requestId: posted[0].requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [zeile('a')], hasMore: false,
    } as never);
    startView('aa', 'aa', post);
    onViewRows({
      type: 'viewRows', requestId: rowPosted()[1].requestId!, dimName: 'aa', hierName: 'aa', ok: false,
      message: 'Syntaxfehler bei "Membrs"',
    } as never);
    expect(currentRows().map((r) => r.name)).toEqual(['a']);
    expect(flashBannerMock).toHaveBeenCalledWith(expect.stringContaining('Membrs'));
  });
});
