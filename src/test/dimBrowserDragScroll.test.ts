/**
 * The three building blocks against sluggish dragging upwards.
 *
 * Finding (2026-08-04): when reordering by drag, the list only slid
 * upwards reluctantly. Three causes that reinforced each other:
 *
 * 1. There was NO auto-scrolling of our own — what scrolled was Chromium's native
 *    drag autoscroll with a fixed, slow rate and a trigger zone of
 *    a few pixels at the edge.
 * 2. `_drawViewport` hung unthrottled on the `scroll` event and replaces the
 *    complete `tbody` via `innerHTML`. Every scroll tick thereby destroyed the
 *    row under the pointer, so that the drop target had to be resolved again.
 * 3. The insertion line hung as a CSS class on the DOM node and was gone after each
 *    of these rebuilds — exactly where you wanted to aim.
 *
 * The decisions behind them are tested purely here; the wiring
 * (dragover loop, scroll listener, row building) lives in `dragDrop.ts` and
 * `render.ts` and is guarded by the source guard in `dimBrowserDomWiring.test.ts`
 * — there is no jsdom in this project.
 */

import { describe, it, expect } from 'vitest';
import { rafThrottle } from '../webviewClient/dimensionBrowser/pure';
import { spacerHtml } from '../webviewClient/dimensionBrowser/viewRender';
import {
  startView, onViewRows, currentRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';

describe('rafThrottle', () => {
  it('runs the body once per frame, no matter how often it was called', () => {
    const frames: Array<() => void> = [];
    let runs = 0;
    const throttled = rafThrottle(() => { runs++; }, (cb) => { frames.push(cb); return frames.length; });

    throttled(); throttled(); throttled();
    expect(runs).toBe(0);          // nothing has run yet — only scheduled
    expect(frames.length).toBe(1); // and EXACTLY once at that

    frames[0]();
    expect(runs).toBe(1);
  });

  it('schedules again after the frame', () => {
    const frames: Array<() => void> = [];
    let runs = 0;
    const throttled = rafThrottle(() => { runs++; }, (cb) => { frames.push(cb); return frames.length; });

    throttled();
    frames[0]();
    throttled();
    expect(frames.length).toBe(2);
    frames[1]();
    expect(runs).toBe(2);
  });
});

describe('dragging over a virtualized body', () => {
  it('does not hit the spacer', () => {
    // The spacer is a <tr> like any other. If it carries no data-idx,
    // `closest('tr[data-idx]')` and `querySelectorAll('tr[data-idx]')`
    // pick up only real rows by themselves — without viewDrag having to know about it.
    expect(spacerHtml(500)).not.toContain('data-idx');
  });

  it('the click path finds the spacer — and discards it', () => {
    // `viewPath.ts:597` selects with `closest('tr')` WITHOUT an attribute filter, so it
    // does hit the spacer. It is still safe, but one line
    // later: `getAttribute('data-idx')` returns null and the handler bails
    // out. A different reason than for viewDrag — and it hinges on a
    // null check that someone might consider superfluous.
    expect(spacerHtml(500)).toContain('<tr class="vspacer"');
    expect(spacerHtml(500)).not.toContain('data-idx');
  });

  it('resolves the target via the rows array, not via the DOM', () => {
    // `nameAt` is the only path from the position to the name, and it reads
    // `currentRows()`. A row that is not drawn at the moment therefore still
    // has a name — otherwise every drag beyond the edge of the window
    // would be a hit into nothing.
    _resetViewPathForTest();
    const posts: Array<{ type: string; requestId?: number }> = [];
    (globalThis as unknown as { document: unknown }).document = {
      getElementById: () => null,
    };
    startView('dim', 'hier', (m) => posts.push(m as { type: string }));
    const id = (posts.filter((p) => p.type === 'fetchViewRows').pop() as
      { requestId: number }).requestId;
    const rows = Array.from({ length: 100000 }, (_, i) => ({
      name: `e${i}`, caption: `e${i}`, type: 'N' as const,
      level: 0, parent: null, drilled: false, ancestors: [],
    }));
    onViewRows({
      type: 'viewRows', requestId: id, dimName: 'd', hierName: 'h',
      ok: true, rows, hasMore: false,
    } as never);
    expect(currentRows()[90000].name).toBe('e90000');
  });
});
