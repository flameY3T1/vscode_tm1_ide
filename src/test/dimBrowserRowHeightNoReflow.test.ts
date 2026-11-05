// The drawer now only measures the row height when it CAN have changed —
// not in every frame (review 2026-08-24, H7).
//
// Why this matters: `measureRowH` calls `getBoundingClientRect()` on a `<tbody>`
// that was just written via `innerHTML`. The renderer has to lay out immediately
// for that, instead of collecting the frame to the end — while dragging the
// scrollbar, one forced reflow per frame. What is measured here is not the time
// but how often the drawer asks for the height at all: `querySelector` on
// `tr.vw-row` is the only place where that happens.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__l10n = { loaded: '{0} von {1}' };
});

import {
  startView, onViewRows, _resetViewPathForTest,
} from '../webviewClient/dimensionBrowser/viewPath';
import { drawWindow } from '../webviewClient/dimensionBrowser/viewViewport';

let messungen = 0;

function domAufbauen(): void {
  messungen = 0;
  const rest: Record<string, unknown> = {};
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => {
      if (!rest[id]) {
        rest[id] = {
          style: { display: '', minWidth: '' }, title: '', innerHTML: '', textContent: '',
          classList: { add: () => {}, remove: () => {}, toggle: () => {} },
          setAttribute: () => {}, addEventListener: () => {},
          querySelectorAll: () => [], scrollTop: 0, scrollHeight: 0, clientHeight: 600,
          // Only the table body is measured; every query counts.
          querySelector: (sel: string) => {
            if (id !== 'table-body' || sel !== 'tr.vw-row') { return null; }
            messungen++;
            return { getBoundingClientRect: () => ({ height: 22 }) };
          },
          getBoundingClientRect: () => ({ height: 0, top: 0 }),
        };
      }
      return rest[id];
    },
  };
}

/** Feed in an answer with `n` rows. */
function antwort(posted: { type?: string; requestId?: number }[], n: number): void {
  const rid = (posted.filter((p) => p.type === 'fetchViewRows').at(-1) as { requestId: number }).requestId;
  onViewRows({
    type: 'viewRows', requestId: rid, dimName: 'aa', hierName: 'aa', ok: true,
    rows: Array.from({ length: n }, (_, i) => ({
      name: 'E' + i, caption: 'E' + i, type: 'N', level: 0,
      parent: null, ancestors: [], drilled: false,
    })),
    hasMore: false,
  } as never);
}

describe('the row height is not measured in every frame', () => {
  let posted: { type?: string; requestId?: number }[] = [];
  const post = (m: unknown): void => { posted.push(m as never); };

  beforeEach(() => {
    posted = [];
    _resetViewPathForTest();
    domAufbauen();
  });

  it('measures on the first draw with rows', () => {
    startView('aa', 'aa', post);
    antwort(posted, 50);
    expect(messungen).toBeGreaterThan(0);
  });

  it('does NOT measure again on a plain redraw', () => {
    startView('aa', 'aa', post);
    antwort(posted, 50);
    const nachAntwort = messungen;

    // Three scroll frames: the drawer runs, the height is not asked for.
    drawWindow();
    drawWindow();
    drawWindow();

    expect(messungen).toBe(nachAntwort);
  });

  it('measures again as soon as a new answer brings rows', () => {

    startView('aa', 'aa', post);
    antwort(posted, 50);
    drawWindow();
    const vorher = messungen;

    startView('aa', 'aa', post);
    antwort(posted, 50);

    expect(messungen).toBeGreaterThan(vorher);
  });
});
