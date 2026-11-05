import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionHandlers } from '../webviewClient/dimensionBrowser/msgSession';
import { state } from '../webviewClient/dimensionBrowser/state';
import { _resetViewPathForTest, onViewRows } from '../webviewClient/dimensionBrowser/viewPath';

/**
 * Final review plan 3, Critical: the new loading path drew into an
 * invisible container. `#pane-single`/`#table-container` start as
 * `display:none` (CSS) and are shown EXCLUSIVELY by `setViewPhase`
 * — the old path solved this via the host message
 * `setLoading:false`, which the new path never posts. Without the fix the
 * user was stuck in front of the loading spinner for good, although the rows had long been in the DOM.
 *
 * This test runs the REAL round trip: `setHierarchies` (host message,
 * real `sessionHandlers` call) starts the new path, `onViewRows`
 * (`viewPath.ts`) delivers the answer — exactly the two places between which
 * the bug lay.
 */

interface FakeEl {
  style: Record<string, string>; innerHTML: string; textContent: string; title: string;
  // The counter and the toggles touch both.
  classList: { contains: () => boolean; toggle: () => void; add: () => void; remove: () => void };
  setAttribute: () => void;
  addEventListener: (t: string, h: (e: unknown) => void) => void;
}

let els: Record<string, FakeEl>;

function el(id: string): FakeEl {
  return (els[id] ??= {
    style: {}, innerHTML: '', textContent: '', title: '',
    classList: { contains: () => false, toggle: () => {}, add: () => {}, remove: () => {} },
    setAttribute: () => {},
    addEventListener: () => {},
  });
}

beforeEach(() => {
  els = {};
  _resetViewPathForTest();
  (globalThis as unknown as Record<string, unknown>).document = {
    getElementById: (id: string) => el(id),
    body: { classList: { add: () => {} } },
  };
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).document;
  state._currentDim = '';
  state._currentHier = '';
});

describe('new loading path: coarse view after the round trip', () => {
  it('shows pane/table instead of staying at the CSS start value (or "loading")', () => {
    const posted: Array<{ type: string; requestId?: number }> = [];
    const vscode = { postMessage: (m: unknown) => { posted.push(m as never); } };

    sessionHandlers.setHierarchies(
      { type: 'setHierarchies', hiers: ['aa'], selectedHier: 'aa', selectedDim: 'aa' } as never,
      { vscode },
    );

    // Immediately on "loading", before the answer arrives — the pane stays hidden.
    expect(el('loading').style.display).toBe('flex');
    expect(el('pane-single').style.display).toBe('none');
    expect(el('table-container').style.display).toBe('none');

    const req = posted.find((m) => m.type === 'fetchViewRows');
    expect(req).toBeDefined();

    onViewRows({
      type: 'viewRows', requestId: req!.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
      rows: [{ name: 'a', caption: 'a', type: 'N', level: 0, parent: null, ancestors: [], drilled: false }],
      hasMore: false,
    } as never);

    // After the answer: ready — exactly the five values from `viewPhase.ts#PHASE.ready`.
    expect(el('loading').style.display).toBe('none');
    expect(el('pane-single').style.display).toBe('flex');
    expect(el('table-container').style.display).toBe('block');
  });

  it('first error without previous rows: error screen instead of a permanent spinner', () => {
    const posted: Array<{ type: string; requestId?: number }> = [];
    const vscode = { postMessage: (m: unknown) => { posted.push(m as never); } };

    sessionHandlers.setHierarchies(
      { type: 'setHierarchies', hiers: ['aa'], selectedHier: 'aa', selectedDim: 'aa' } as never,
      { vscode },
    );
    const req = posted.find((m) => m.type === 'fetchViewRows');

    onViewRows({
      type: 'viewRows', requestId: req!.requestId!, dimName: 'aa', hierName: 'aa', ok: false,
      message: 'Syntaxfehler',
    } as never);

    expect(el('loading').style.display).toBe('none');
    expect(el('pane-single').style.display).toBe('none');
    expect(el('error-banner').style.display).toBe('block');
    expect(el('error-banner').textContent).toContain('Syntaxfehler');
  });
});

describe('new loading path: the subset list is fetched', () => {
  it('posts `fetchSubsets` although the old branch is skipped', () => {
    // The three regular senders are all dead in the new path: `setHierarchies`
    // returns before them, the hierarchy dropdown and "Refresh" are
    // blocked (`dom.ts`). All that remained was the follow-up fetch after a
    // successful save (`msg.ts`) — so until then the select field only showed
    // its three static entries, and "Default element" as well as
    // all public and private subsets were missing (click test
    // 2026-08-23: "in my aa dimension; in others it works" — there a save
    // had happened before).
    //
    // `fetchSubsets` fetches NO elements: it fills a select field. The
    // `return` that keeps `fetchElements` away has nothing to do with it.
    const posted: Array<{ type: string }> = [];
    const vscode = { postMessage: (m: unknown) => { posted.push(m as never); } };

    sessionHandlers.setHierarchies(
      { type: 'setHierarchies', hiers: ['aa'], selectedHier: 'aa', selectedDim: 'aa' } as never,
      { vscode },
    );

    expect(posted.filter((m) => m.type === 'fetchSubsets')).toHaveLength(1);
    // And still NO element query of the old path.
    expect(posted.filter((m) => m.type === 'fetchElements')).toHaveLength(0);
  });
});
