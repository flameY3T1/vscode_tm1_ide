import { describe, it, expect, beforeEach } from 'vitest';
import {
  toggleBreakpoint, setBreakpointCondition, getCondition, getHitCondition, getBreakpoints, clearAllBreakpoints,
  getBreakpointEntries, onBreakpointsMutated,
} from '../webviewClient/processEditorMonaco/breakpoints';

// initBreakpoints is NOT called → state.monaco stays null → applyDecorations no-ops.
describe('breakpoint conditions', () => {
  beforeEach(() => clearAllBreakpoints());

  it('stores and reads a condition for a breakpoint line', () => {
    toggleBreakpoint('prolog', 10);
    setBreakpointCondition('prolog', 10, 'vN > 5');
    expect(getCondition('prolog', 10)).toBe('vN > 5');
  });

  it('getBreakpoints includes the condition', () => {
    toggleBreakpoint('data', 3);
    setBreakpointCondition('data', 3, "sX @= 'A'");
    expect(getBreakpoints()).toEqual([{ section: 'data', line: 3, condition: "sX @= 'A'" }]);
  });

  it('empty expression clears the condition', () => {
    toggleBreakpoint('prolog', 10);
    setBreakpointCondition('prolog', 10, 'vN > 5');
    setBreakpointCondition('prolog', 10, '   ');
    expect(getCondition('prolog', 10)).toBeUndefined();
    expect(getBreakpoints()).toEqual([{ section: 'prolog', line: 10 }]);
  });

  it('toggling a breakpoint off clears its condition', () => {
    toggleBreakpoint('prolog', 10);
    setBreakpointCondition('prolog', 10, 'vN > 5');
    toggleBreakpoint('prolog', 10); // off
    expect(getCondition('prolog', 10)).toBeUndefined();
  });

  it('stores and reads a hit condition', () => {
    toggleBreakpoint('prolog', 7);
    setBreakpointCondition('prolog', 7, '', '>=5');
    expect(getHitCondition('prolog', 7)).toBe('>=5');
    expect(getBreakpoints()).toEqual([{ section: 'prolog', line: 7, hitCondition: '>=5' }]);
  });
  it('carries both condition and hit condition', () => {
    toggleBreakpoint('data', 2);
    setBreakpointCondition('data', 2, 'vN > 10', '%3');
    expect(getCondition('data', 2)).toBe('vN > 10');
    expect(getHitCondition('data', 2)).toBe('%3');
    expect(getBreakpoints()).toEqual([{ section: 'data', line: 2, condition: 'vN > 10', hitCondition: '%3' }]);
  });
  it('empty hit condition clears it', () => {
    toggleBreakpoint('prolog', 7);
    setBreakpointCondition('prolog', 7, '', '>=5');
    setBreakpointCondition('prolog', 7, '', '  ');
    expect(getHitCondition('prolog', 7)).toBeUndefined();
  });
});

describe('breakpoint overview', () => {
  beforeEach(() => clearAllBreakpoints());

  it('getBreakpointEntries returns entries sorted by section order then line', () => {
    toggleBreakpoint('epilog', 5);
    toggleBreakpoint('prolog', 20);
    toggleBreakpoint('prolog', 3);
    toggleBreakpoint('data', 8);
    const entries = getBreakpointEntries();
    expect(entries.map((e) => `${e.section}:${e.line}`)).toEqual(['prolog:3', 'prolog:20', 'data:8', 'epilog:5']);
  });

  it('entry carries status, condition and hitCondition', () => {
    toggleBreakpoint('data', 2);
    setBreakpointCondition('data', 2, 'vN > 10', '%3');
    const e = getBreakpointEntries().find((x) => x.section === 'data' && x.line === 2);
    expect(e).toBeTruthy();
    expect(e?.condition).toBe('vN > 10');
    expect(e?.hitCondition).toBe('%3');
    expect(e?.status).toBe('pending');
  });

  it('onBreakpointsMutated fires on add and on condition change', () => {
    let n = 0;
    onBreakpointsMutated(() => { n++; });
    toggleBreakpoint('prolog', 1);
    setBreakpointCondition('prolog', 1, 'x=1', '');
    expect(n).toBeGreaterThanOrEqual(2);
    onBreakpointsMutated(() => {}); // detach to avoid leaking into other tests
  });
});
