import { describe, it, expect } from 'vitest';
import { runRule, planRename } from '../../tiConsistency/engine';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(name: string, prolog: string, params: ConsistencyProcess['params'] = []): ConsistencyProcess {
  return { name, units: [{ key: 'prolog', text: prolog }], params, datasourceVars: [],
    rawParams: params.map(p => ({ Name: p.name, Type: p.type, Value: '', Prompt: '' })), rawVariables: [] };
}

describe('runRule var-casing', () => {
  it('groups two spellings across processes into one group', () => {
    const groups = runRule('var-casing', [proc('A', 'sDim = 1;'), proc('B', 'nX = SDIM;')]);
    const g = groups.find(x => x.key === 'sdim');
    expect(g?.variants.map(v => v.spelling).sort()).toEqual(['SDIM', 'sDim']);
    expect(g?.targetSuggestion).toBeDefined();
  });
  it('does not report a single-spelling identifier', () => {
    expect(runRule('var-casing', [proc('A', 'sDim = 1;\nnX = sDim;')]).find(x => x.key === 'sdim')).toBeUndefined();
  });
});

describe('planRename', () => {
  it('renames every spelling to target and builds section edits', () => {
    const procs = [proc('A', 'sDim = 1;'), proc('B', 'nX = SDIM;')];
    const groups = runRule('var-casing', procs);
    const plan = planRename('var-casing', groups.find(g => g.key === 'sdim')!, 'sDim', procs);
    expect(plan.edits.find(e => e.process === 'B')?.changedSections.prolog).toBe('nX = sDim;');
    expect(plan.skipped).toEqual([]);
  });
  it('collision-guard skips a process where target equals a different existing var', () => {
    const procs = [proc('A', "Dim = 'x';\nsDim = 'y';")];
    const groups = runRule('variable-naming', procs);
    const g = groups.find(x => x.key === 'dim')!;
    const plan = planRename('variable-naming', g, 'sDim', procs);
    expect(plan.edits).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({ process: 'A' });
  });
  it('collision-guard does not false-positive on a target name that only appears inside a string literal', () => {
    const procs = [proc('A', "Dim = 'x';\nTextOutput('Report for sDim goes here');")];
    const groups = runRule('variable-naming', procs);
    const g = groups.find(x => x.key === 'dim')!;
    const plan = planRename('variable-naming', g, 'sDim', procs);
    expect(plan.skipped).toEqual([]);
    expect(plan.edits.find(e => e.process === 'A')).toBeDefined();
  });
  it('emits declPatch for a param rename', () => {
    // NB: uses 'Region' rather than 'Month' — MONTH is a real TI built-in function
    // (in KNOWN_SIGNATURES), so a param literally named 'Month' is now correctly
    // excluded as reserved by paramNamingRule.
    const procs = [proc('A', 'nX = Region;', [{ name: 'Region', type: 'String' }])];
    const groups = runRule('param-naming', procs);
    const g = groups.find(x => x.key === 'region')!;
    const plan = planRename('param-naming', g, 'pRegion', procs);
    expect(plan.edits[0].declPatch?.params).toEqual([{ from: 'Region', to: 'pRegion' }]);
  });
  it('renames a param not referenced in the body via declPatch only (decl-only rename)', () => {
    // Region is declared but never used in prolog code — zero body occurrences.
    const procs = [proc('A', '# no reference to the param here', [{ name: 'Region', type: 'String' }])];
    const groups = runRule('param-naming', procs);
    const g = groups.find(x => x.key === 'region')!;
    const plan = planRename('param-naming', g, 'pRegion', procs);
    const edit = plan.edits.find(e => e.process === 'A');
    expect(edit).toBeDefined();
    expect(edit?.declPatch?.params).toEqual([{ from: 'Region', to: 'pRegion' }]);
    expect(plan.skipped).toEqual([]);
  });
  it('renames a datasource var not referenced in the body via declPatch only (decl-only rename)', () => {
    // Region is a datasource var but never used in prolog code — zero body occurrences.
    const procs: ConsistencyProcess[] = [{
      name: 'A',
      units: [{ key: 'prolog', text: '# no reference to the datasource var here' }],
      params: [],
      datasourceVars: [{ name: 'Region', type: 'String' }],
      rawParams: [],
      rawVariables: [{ Name: 'Region', Type: 'String', Position: 0, StartByte: 0, EndByte: 0 }],
    }];
    const groups = runRule('datasource-naming', procs);
    const g = groups.find(x => x.key === 'region')!;
    const plan = planRename('datasource-naming', g, 'vRegion', procs);
    const edit = plan.edits.find(e => e.process === 'A');
    expect(edit).toBeDefined();
    expect(edit?.declPatch?.datasourceVars).toEqual([{ from: 'Region', to: 'vRegion' }]);
    expect(plan.skipped).toEqual([]);
  });
});
