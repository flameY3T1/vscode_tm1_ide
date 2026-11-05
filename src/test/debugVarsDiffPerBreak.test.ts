/**
 * The "changed since the last stop" marking disappeared after a few
 * seconds, although the process stood unchanged at the same breakpoint
 * (flameY3T1, 2026-09-01).
 *
 * Cause: during a pause the host keeps polling and reports the same
 * position again (`debug.ts`). Every poll renders the panel, and the panel
 * re-baselined at the end of EVERY render. On the second poll it therefore compared the values
 * against themselves and found nothing anymore. The "few seconds" were the
 * poll interval.
 *
 * The comparison therefore belongs to the STOP, not to the render.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { changedNamesForBreak, resetDebugVarsDiff } from '../webviewClient/processEditorMonaco/debugVarsDiff';

const vars = (o: Record<string, string | number>) =>
  Object.entries(o).map(([name, value]) => ({ name, value }));

describe('debugVarsDiff: comparison per stop, not per render', () => {
  beforeEach(() => resetDebugVarsDiff());

  it('keeps the marking across all polls of the same stop', () => {
    // First stop: empty baseline, nothing is "changed".
    expect([...changedNamesForBreak(vars({ a: 1, b: 'x' }), true)]).toEqual([]);
    expect([...changedNamesForBreak(vars({ a: 1, b: 'x' }), true)]).toEqual([]);

    // Continue, then a second stop with a changed a.
    changedNamesForBreak(vars({ a: 1, b: 'x' }), false);
    expect([...changedNamesForBreak(vars({ a: 2, b: 'x' }), true)]).toEqual(['a']);

    // THAT was the bug: the same stop, next poll.
    expect([...changedNamesForBreak(vars({ a: 2, b: 'x' }), true)]).toEqual(['a']);
    expect([...changedNamesForBreak(vars({ a: 2, b: 'x' }), true)]).toEqual(['a']);
  });

  it('compares the next stop against the previous one, not against the session start', () => {
    changedNamesForBreak(vars({ a: 1, b: 1 }), true);
    changedNamesForBreak(vars({ a: 1, b: 1 }), false);
    expect([...changedNamesForBreak(vars({ a: 2, b: 1 }), true)]).toEqual(['a']);
    changedNamesForBreak(vars({ a: 2, b: 1 }), false);
    // b changes, a stays put: at the third stop a is NO longer marked.
    expect([...changedNamesForBreak(vars({ a: 2, b: 9 }), true)]).toEqual(['b']);
  });

  it('a new variable counts as changed', () => {
    changedNamesForBreak(vars({ a: 1 }), true);
    changedNamesForBreak(vars({ a: 1 }), false);
    expect([...changedNamesForBreak(vars({ a: 1, neu: 3 }), true)]).toEqual(['neu']);
  });

  it('keeps the marking while continuing, so that the list does not flash', () => {
    changedNamesForBreak(vars({ a: 1 }), true);
    changedNamesForBreak(vars({ a: 1 }), false);
    changedNamesForBreak(vars({ a: 2 }), true);
    expect([...changedNamesForBreak(vars({ a: 2 }), false)]).toEqual(['a']);
  });

  it('resetDebugVarsDiff makes the next stop the first one again', () => {
    changedNamesForBreak(vars({ a: 1 }), true);
    changedNamesForBreak(vars({ a: 1 }), false);
    resetDebugVarsDiff();
    expect([...changedNamesForBreak(vars({ a: 99 }), true)]).toEqual([]);
  });
});
