import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionHandlers } from '../webviewClient/dimensionBrowser/msgSession';
import { _resetViewPathForTest, onViewRows } from '../webviewClient/dimensionBrowser/viewPath';
import { applyFilter } from '../webviewClient/dimensionBrowser/viewLayers';

interface FakeEl { style: Record<string, string>; innerHTML: string; textContent: string; value: string; addEventListener: () => void; classList: { add: () => void; remove: () => void; contains: () => boolean; toggle: () => void }; setAttribute: () => void }
let els: Record<string, FakeEl>;
const el = (id: string): FakeEl => (els[id] ??= {
  // `display: 'none'` as the default mirrors the scaffold
  // (`dimensionBrowserBody.ts`: `#subset-mdx-bar` and `#vw-trail` start
  // hidden). An empty `style` would make the visibility test worthless.
  style: { display: 'none' }, innerHTML: '', textContent: '', value: '',
  addEventListener: () => {},
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
  setAttribute: () => {},
});

beforeEach(() => {
  els = {};
  _resetViewPathForTest();
  (globalThis as unknown as Record<string, unknown>).document = {
    getElementById: (id: string) => el(id),
    body: { classList: { add: () => {} } },
  };
});
afterEach(() => { delete (globalThis as unknown as { __tm1NewViewPath?: boolean }).__tm1NewViewPath; });

function starte(): Array<{ type: string; requestId?: number }> {
  const posted: Array<{ type: string; requestId?: number }> = [];
  sessionHandlers.setHierarchies(
    { type: 'setHierarchies', hiers: ['aa'], selectedHier: 'aa', selectedDim: 'aa' } as never,
    { vscode: { postMessage: (m: unknown) => { posted.push(m as never); } } } as never,
  );
  return posted;
}
function antworte(posted: Array<{ type: string; requestId?: number }>): void {
  const req = posted.filter((m) => m.type === 'fetchViewRows').pop()!;
  onViewRows({
    type: 'viewRows', requestId: req.requestId!, dimName: 'aa', hierName: 'aa', ok: true,
    rows: [{ name: 'a', caption: 'a', type: 'N', level: 0, parent: null, ancestors: [], drilled: false }],
    hasMore: false,
  } as never);
}

describe('the MDX bar in the new path', () => {
  it('shows the base expression after the first draw', () => {
    antworte(starte());
    expect(el('subset-mdx-text').textContent).toBe('{[aa].[aa].Members}');
  });

  it('grows with every layer', () => {
    const posted = starte();
    antworte(posted);
    applyFilter({ kind: 'type', types: ['C'] });
    antworte(posted);
    expect(el('subset-mdx-text').textContent).toBe(
      '{FILTER({[aa].[aa].Members}, [aa].[aa].CurrentMember.Properties("ELEMENT_TYPE") = "3")}',
    );
  });

  it('NEVER carries the window — a saved set has no scroll position', () => {
    antworte(starte());
    expect(el('subset-mdx-text').textContent).not.toContain('SUBSET');
  });

  it('makes the bar VISIBLE — it starts as display:none in the scaffold', () => {
    // Pre-review ruling F2. Without this assertion the test would be green and
    // the user would see nothing — the bug class of the Plan 3 critical.
    expect(el('subset-mdx-bar').style.display).toBe('none');
    antworte(starte());
    expect(el('subset-mdx-bar').style.display).toBe('flex');
  });
});
