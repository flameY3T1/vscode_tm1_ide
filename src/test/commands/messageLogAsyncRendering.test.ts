// The display bundles asynchronously attached runs into ONE row.
//
// Without that, thousands of rows quickly hang under one caller (in the real log
// 3580 under a single one), and the real children next to them drown in them.
//
// The renderer lives in `webviewClient/messageLogAnalysis/render.ts` and is
// called directly here.
import { describe, it, expect } from 'vitest';
import { renderKids as render } from '../../webviewClient/messageLogAnalysis/render';
import type { CallNodeView, MlaTexts } from '../../webviewClient/messageLogAnalysis/protocol';

const L: MlaTexts = {
  running: 'running', proc: 'Process', calls: 'Calls', fail: 'Errors', entries: 'entries',
  runs: 'runs', ignored: 'ignored', uncertain: 'Uncertain', ambigTip: 'ambig', uncExcluded: 'excl',
  truncTip: 'trunc', incTip: 'inc', choreTip: 'chore', asyncTip: 'async',
  asyncRuns: '{0} asynchronous runs', shortHidden: '{0} short runs under {1} s not listed', errorLog: 'Error log',
};
const renderKids = (kids: unknown[]): string => render(kids as CallNodeView[], L);

function lauf(name: string, opts: Partial<{ elapsedSec: number | null; asyncAttached: boolean; startTs: string; endTs: string }> = {}): unknown {
  return {
    name, kind: 'process', status: 'ok', children: [],
    startTs: '2026-08-26T07:00:00.000Z', elapsedSec: 1, selfSec: 1, selfPct: 100,
    truncated: false, ambiguous: false, inconsistent: false, ...opts,
  };
}

describe('asynchronous runs in the analysis display', () => {
  it('turns many same-named asynchronous runs into ONE row', () => {
    const kids = Array.from({ length: 40 }, () => lauf('Fan', { asyncAttached: true }));
    const html = renderKids(kids);
    expect((html.match(/class="node async-group"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('40');
  });

  it('leaves real children untouched side by side', () => {
    const html = renderKids([
      lauf('Echt'),
      lauf('Fan', { asyncAttached: true }),
      lauf('Fan', { asyncAttached: true }),
    ]);
    expect((html.match(/class="node async-group"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('Echt');
  });

  it('separates different targets into rows of their own', () => {
    const html = renderKids([
      lauf('A', { asyncAttached: true }),
      lauf('B', { asyncAttached: true }),
    ]);
    expect((html.match(/class="node async-group"/g) ?? [])).toHaveLength(2);
  });

  it('sums the runtimes in the summary row', () => {
    const html = renderKids([
      lauf('Fan', { asyncAttached: true, elapsedSec: 2 }),
      lauf('Fan', { asyncAttached: true, elapsedSec: 3 }),
    ]);
    expect(html).toMatch(/class="incl">5/);
  });

  it('does NOT list short rollbacks individually', () => {
    // A rollback on a lock conflict reports no runtime and lasts
    // hundredths of a second. In the real log these were 484 of them — pure noise.
    const kids = [
      lauf('Fan', { asyncAttached: true, elapsedSec: 2 }),
      ...Array.from({ length: 5 }, () => lauf('Fan', {
        asyncAttached: true, elapsedSec: null,
        startTs: '2026-08-26T07:00:00.000Z', endTs: '2026-08-26T07:00:00.010Z',
      })),
    ];
    const html = renderKids(kids);
    // Six runs counted, but only one listed.
    expect(html).toContain('6');
    expect((html.match(/class="node"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('short-hint');
  });

  it('does list LONGER rollbacks', () => {
    const html = renderKids([
      lauf('Fan', {
        asyncAttached: true, elapsedSec: null,
        startTs: '2026-08-26T07:00:00.000Z', endTs: '2026-08-26T07:00:12.000Z',
      }),
    ]);
    expect(html).not.toContain('short-hint');
    expect((html.match(/class="node"/g) ?? [])).toHaveLength(1);
  });

  it('treats a run without an end stamp as displayable', () => {
    // Without an end, the span cannot be formed — then nothing is guessed.
    const html = renderKids([lauf('Fan', { asyncAttached: true, elapsedSec: null })]);
    expect(html).not.toContain('short-hint');
  });
});
