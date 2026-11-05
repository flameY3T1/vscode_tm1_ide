import { describe, it, expect } from 'vitest';
import { decideBreakpointStop } from '../debug/conditionEval';

const noVars: Array<{ name: string; value: string }> = [];

describe('decideBreakpointStop', () => {
  it('no rule → pause, hits unchanged', () => {
    expect(decideBreakpointStop(undefined, noVars, 0)).toEqual({ pause: true, newHits: 0 });
  });
  it('condition false → no pause, hits NOT advanced', () => {
    const r = decideBreakpointStop({ condition: 'vN > 10' }, [{ name: 'vN', value: '5' }], 3);
    expect(r.pause).toBe(false);
    expect(r.newHits).toBe(3);
  });
  it('condition true + no hit spec → pause, hits unchanged', () => {
    const r = decideBreakpointStop({ condition: 'vN > 10' }, [{ name: 'vN', value: '20' }], 0);
    expect(r).toEqual({ pause: true, newHits: 0 });
  });
  it('hit spec advances only when condition passes; pauses at threshold', () => {
    const rule = { condition: 'vN > 10', hitCondition: '>=2' };
    const pass = [{ name: 'vN', value: '20' }];
    expect(decideBreakpointStop(rule, pass, 0)).toEqual({ pause: false, newHits: 1 });
    expect(decideBreakpointStop(rule, pass, 1)).toEqual({ pause: true, newHits: 2 });
  });
  it('condition error → pause fail-safe, hits NOT advanced', () => {
    const r = decideBreakpointStop({ condition: 'vMissing > 1' }, noVars, 4);
    expect(r.pause).toBe(true);
    expect(r.error).toBeTruthy();
    expect(r.newHits).toBe(4);
  });
  it('invalid hit spec → pause fail-safe, hits advanced (qualifying stop)', () => {
    const r = decideBreakpointStop({ hitCondition: 'abc' }, noVars, 0);
    expect(r.pause).toBe(true);
    expect(r.error).toBeTruthy();
    expect(r.newHits).toBe(1);
  });
});
