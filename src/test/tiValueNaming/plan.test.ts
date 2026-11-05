import { describe, it, expect } from 'vitest';
import { planNameUnify } from '../../tiValueNaming/plan';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(name: string, prolog: string): ConsistencyProcess {
  return { name, units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

describe('planNameUnify', () => {
  it('renames a divergent name to canonical, leaving the canonical process untouched', () => {
    const procs = [
      proc('A', "sAllElementsA = 'v';\nnX = sAllElementsA;"),
      proc('B', "sConsolidatedA = 'v';"),
    ];
    const plan = planNameUnify('v', 'sAllElementsA', procs);
    expect(plan.edits.find(e => e.process === 'A')).toBeUndefined();   // already canonical
    expect(plan.edits.find(e => e.process === 'B')?.changedSections.prolog).toBe("sAllElementsA = 'v';");
    expect(plan.skipped).toEqual([]);
  });
  it('collision-guard skips a process where canonical already names a different identifier', () => {
    const procs = [proc('A', "sConsolidatedA = 'v';\nsAllElementsA = 'other';")];
    const plan = planNameUnify('v', 'sAllElementsA', procs);
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ process: 'A' });
  });
  it('refuses to merge two distinct candidate variables in the same process into one canonical name', () => {
    const procs = [proc('A', "sX = 'v';\nsY = 'v';")];
    const plan = planNameUnify('v', 'sConsolidatedA', procs);
    expect(plan.edits.find(e => e.process === 'A')).toBeUndefined();
    expect(plan.edits).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].process).toBe('A');
    expect(plan.skipped[0].reason).toMatch(/merge/i);
  });
  it('matches valueKey case-insensitively (defensive lowercase)', () => {
    const procs = [proc('A', "sConsolidatedA = 'v';")];
    const plan = planNameUnify('V', 'sAllElementsA', procs);
    expect(plan.edits.find(e => e.process === 'A')?.changedSections.prolog).toBe("sAllElementsA = 'v';");
    expect(plan.skipped).toEqual([]);
  });
  it('namesToRename: only folds checked names, leaving unchecked ones untouched', () => {
    const procs = [
      proc('A', "csCube = 'v';"),        // checked -> renamed
      proc('B', "csTargetCube = 'v';"),  // unchecked -> kept
    ];
    const plan = planNameUnify('v', 'csSourceCube', procs, ['csCube']);
    expect(plan.edits.find(e => e.process === 'A')?.changedSections.prolog).toBe("csSourceCube = 'v';");
    expect(plan.edits.find(e => e.process === 'B')).toBeUndefined(); // csTargetCube not in the set
    expect(plan.skipped).toEqual([]);
  });
  it('namesToRename matches case-insensitively', () => {
    const procs = [proc('A', "csCube = 'v';")];
    const plan = planNameUnify('v', 'csSourceCube', procs, ['CSCUBE']);
    expect(plan.edits.find(e => e.process === 'A')?.changedSections.prolog).toBe("csSourceCube = 'v';");
  });
  it('namesToRename turns a would-be merge into a safe single rename when one var is unchecked', () => {
    // sSource + sTarget share value 'v' in one process. Unchecking sTarget leaves a
    // single candidate (sSource -> canonical), so no merge refusal fires.
    const procs = [proc('A', "sSource = 'v';\nsTarget = 'v';")];
    const plan = planNameUnify('v', 'csSourceCube', procs, ['sSource']);
    expect(plan.edits.find(e => e.process === 'A')?.changedSections.prolog).toBe("csSourceCube = 'v';\nsTarget = 'v';");
    expect(plan.skipped).toEqual([]);
  });
});
