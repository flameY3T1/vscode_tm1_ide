import { describe, it, expect, beforeEach } from 'vitest';
import {
  initBreakpoints, toggleBreakpoint, clearAllBreakpoints, getBreakpoints, onBreakpointsMutated,
} from '../webviewClient/processEditorMonaco/breakpoints';

// "Delete all" in the breakpoints overview must stay cheap locally (one table
// rebuild) while still telling the debug server about every single removal —
// the host protocol has no bulk `setBreakpoint`.
//
// Own file on purpose: `initBreakpoints` installs a module-level bridge that
// would otherwise leak into the bridge-less breakpointsConditions.test.ts.
type InitArgs = Parameters<typeof initBreakpoints>;

let sent: Array<{ section: string; line: number; enabled: boolean }> = [];
let changedCalls: Array<Array<{ section: string; line: number }>> = [];
let mutations = 0;
let debugging = false;

const fakeModel = {
  getLineCount: () => 1000,
  deltaDecorations: (_old: string[], _next: unknown[]) => [] as string[],
};

const fakeMonaco = {
  Range: class { constructor(_a: number, _b: number, _c: number, _d: number) {} },
  editor: {
    TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: 1 },
    MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 },
  },
} as unknown as InitArgs[0];

const fakeBridge = {
  getEditor: () => ({
    onMouseDown:  () => ({ dispose() {} }),
    // Since the ghost point in the breakpoint column, `initBreakpoints`
    // also hangs on these two.
    onMouseMove:  () => ({ dispose() {} }),
    onMouseLeave: () => ({ dispose() {} }),
  }),
  getModel: () => fakeModel,
  getCurrentSection: () => 'prolog' as const,
  isDebugging: () => debugging,
  sendSetBreakpoint: (section: string, line: number, enabled: boolean) => {
    sent.push({ section, line, enabled });
  },
  onBreakpointsChanged: (list: Array<{ section: string; line: number }>) => {
    changedCalls.push(list);
  },
} as unknown as InitArgs[1];

initBreakpoints(fakeMonaco, fakeBridge);
onBreakpointsMutated(() => { mutations++; });

function seedFour(): void {
  toggleBreakpoint('prolog', 3);
  toggleBreakpoint('prolog', 20);
  toggleBreakpoint('data', 8);
  toggleBreakpoint('epilog', 5);
}

/** Reset counters *after* seeding so only the clearAll pass is measured. */
function resetCounters(): void {
  sent = [];
  changedCalls = [];
  mutations = 0;
}

describe('clearAllBreakpoints', () => {
  beforeEach(() => {
    debugging = false;
    clearAllBreakpoints();
    resetCounters();
  });

  it('removes every breakpoint', () => {
    seedFour();
    resetCounters();
    clearAllBreakpoints();
    expect(getBreakpoints()).toEqual([]);
  });

  it('rebuilds the overview once, not once per breakpoint', () => {
    seedFour();
    resetCounters();
    clearAllBreakpoints();
    expect(mutations).toBe(1);
    expect(changedCalls).toHaveLength(1);
    // The single notification already reflects the emptied state.
    expect(changedCalls[0]).toEqual([]);
  });

  it('still sends one removal per breakpoint during a debug session', () => {
    seedFour();
    debugging = true;
    resetCounters();
    clearAllBreakpoints();
    expect(sent).toEqual([
      { section: 'prolog', line: 3, enabled: false },
      { section: 'prolog', line: 20, enabled: false },
      { section: 'data', line: 8, enabled: false },
      { section: 'epilog', line: 5, enabled: false },
    ]);
    // …but the local work stays batched.
    expect(mutations).toBe(1);
  });

  it('sends nothing when no debug session is running', () => {
    seedFour();
    debugging = false;
    resetCounters();
    clearAllBreakpoints();
    expect(sent).toEqual([]);
    expect(getBreakpoints()).toEqual([]);
  });

  it('clears cleanly when there is nothing to clear', () => {
    clearAllBreakpoints();
    expect(sent).toEqual([]);
    expect(getBreakpoints()).toEqual([]);
  });
});
