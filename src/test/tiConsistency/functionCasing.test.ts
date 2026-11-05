import { describe, it, expect, beforeAll } from 'vitest';
import { functionCasingRule } from '../../tiConsistency/rules/functionCasing';
import { initKnownSignatures } from '../../tiLogicVisualizer/tiSignatures';
import type { ConsistencyProcess } from '../../tiConsistency/types';

function proc(prolog: string): ConsistencyProcess {
  return { name: 'P', units: [{ key: 'prolog', text: prolog }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] };
}

beforeAll(() => {
  // NOTE: initKnownSignatures expects [key, TiKnownSignature][] tuples (see
  // tiSignatures.ts `for (const [k, v] of entries)`), not a bare array of
  // signature objects. Seed shape adjusted from the brief accordingly.
  initKnownSignatures([['cellputn', { name: 'CellPutN', minParams: 3, maxParams: 99, params: [], returnType: 'void' }]] as any);
});

describe('functionCasingRule.scan', () => {
  it('flags a function call whose spelling differs from canonical', () => {
    const f = functionCasingRule.scan(proc('cellputn(1, cube, a);'));
    const rf = f.find(x => x.key === 'cellputn');
    expect(rf?.spelling).toBe('cellputn');
    expect(rf?.target).toBe('CellPutN');
    expect(rf?.kind).toBe('function');
  });
  it('ignores unknown identifiers (not TI functions)', () => {
    expect(functionCasingRule.scan(proc('nX = notAFunc + 1;')).find(x => x.key === 'notafunc')).toBeUndefined();
  });
  it('does not flag already-canonical spelling', () => {
    expect(functionCasingRule.scan(proc('CellPutN(1, c, a);')).length).toBe(0);
  });
});
