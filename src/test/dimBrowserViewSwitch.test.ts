import { describe, it, expect, beforeEach } from 'vitest';
import { drawView, _resetViewPathForTest, startView, onViewRows } from '../webviewClient/dimensionBrowser/viewPath';

const zeile = (name: string, ancestors: string[] = [], drilled = false) => ({
  name, caption: name, type: drilled ? 'C' : 'N', level: drilled ? 1 : 0,
  parent: ancestors.length ? ancestors[ancestors.length - 1] : null,
  // Only the names count for deriving the depth — type/level per ancestor are
  // inconsequential filler values here (real values only with `chain: 'name+element'`).
  ancestors: ancestors.map((n) => ({ name: n, type: 'N' as const, level: 0 })),
  drilled,
});

let body: { innerHTML: string; addEventListener: (t: string, h: (e: unknown) => void) => void };
beforeEach(() => {
  _resetViewPathForTest();
  // `addEventListener` as a no-op: `startView` now binds the click path (`bindClick`)
  // unchecked — this test checks only `drawView`, not the click.
  body = { innerHTML: 'ALT', addEventListener: () => {} };
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (id === 'table-body' ? body : null),
  };
});

describe('drawView', () => {
  it('writes the rows into the table body', () => {
    startView('aa', 'aa', () => {});
    onViewRows({ type: 'viewRows', requestId: 1, ok: true,
      rows: [zeile('sum', [], true), zeile('a', ['sum'])], hasMore: false } as never);
    drawView();
    expect(body.innerHTML).toContain('sum');
    expect(body.innerHTML).toContain('data-idx="1"');
  });

  it('clears the body when there are no rows', () => {

    drawView();
    expect(body.innerHTML).toBe('');
  });
});
