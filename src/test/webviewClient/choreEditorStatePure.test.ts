import { describe, it, expect } from 'vitest';
import {
  applyParamInput,
  buildSaveTasks,
  failedParamProcesses,
  findInvalidNumericParams,
  formatFrequency,
  mergeParamInputs,
  parseFrequency,
  pendingParamProcesses,
  DEFAULT_FREQ,
  KNOWN_FREQS,
  type ClientTask,
  type ParamsCache,
} from '../../webviewClient/choreEditor/statePure';

// ── Parameter merge (collectParamsFromDom / onParamChange) ────────────────

describe('mergeParamInputs', () => {
  it('overwrites the type of an EXISTING param with the rendered row type', () => {
    // The bug: the chore payload said "String" for a numeric parameter and the
    // merge only ever touched `.value`, so "open and save unchanged" kept it.
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pYear', type: 'String', value: '2025' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pYear', type: 'Numeric', value: '2025' }]);
    expect(tasks[0].params).toEqual([{ name: 'pYear', type: 'Numeric', value: '2025' }]);
  });

  it('overwrites an UNKNOWN ("") type carried over from the chore payload', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pN', type: '', value: '7' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pN', type: 'Numeric', value: '7' }]);
    expect(tasks[0].params[0].type).toBe('Numeric');
  });

  it('keeps the existing type when the row carries none', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pN', type: 'Numeric', value: '1' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pN', type: '', value: '2' }]);
    expect(tasks[0].params[0]).toEqual({ name: 'pN', type: 'Numeric', value: '2' });
  });

  it('pushes params that the task did not have yet', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pNew', type: 'String', value: 'x' }]);
    expect(tasks[0].params).toEqual([{ name: 'pNew', type: 'String', value: 'x' }]);
  });

  it('defaults a pushed param without a row type to String', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pNew', type: '', value: 'x' }]);
    expect(tasks[0].params[0].type).toBe('String');
  });

  it('ignores inputs pointing at a task index that no longer exists', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [] }];
    expect(() => mergeParamInputs(tasks, [{ taskIdx: 3, name: 'x', type: 'String', value: 'v' }])).not.toThrow();
    expect(tasks[0].params).toEqual([]);
  });

  // MED-2: the rendered row stamps `data-param` with the PROCESS definition's
  // casing and matches the stored value case-INsensitively. An exact match here
  // pushed a SECOND entry for the same parameter, both went out, and TM1
  // answered the parameter-count mismatch with a 400 — after the tasks had
  // already been deleted, so it cost a rollback.
  it('matches a stored param case-INsensitively instead of pushing a duplicate', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'PYEAR', type: '', value: '2024' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pYear', type: 'Numeric', value: '2025' }]);
    expect(tasks[0].params).toHaveLength(1);
    expect(tasks[0].params[0]).toEqual({ name: 'pYear', type: 'Numeric', value: '2025' });
  });

  it('adopts the process definition spelling of the parameter name', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pname', type: 'String', value: 'x' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pName', type: 'String', value: 'y' }]);
    expect(tasks[0].params.map(p => p.name)).toEqual(['pName']);
  });

  it('still pushes a genuinely new param when no case-insensitive match exists', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pA', type: 'String', value: '1' }] }];
    mergeParamInputs(tasks, [{ taskIdx: 0, name: 'pB', type: 'String', value: '2' }]);
    expect(tasks[0].params.map(p => p.name)).toEqual(['pA', 'pB']);
  });

  it('applyParamInput behaves like a single-element merge', () => {
    const tasks: ClientTask[] = [{ processName: 'p', params: [{ name: 'pN', type: 'String', value: '' }] }];
    applyParamInput(tasks, { taskIdx: 0, name: 'pN', type: 'Numeric', value: '3' });
    expect(tasks[0].params[0]).toEqual({ name: 'pN', type: 'Numeric', value: '3' });
  });
});

// ── Save-while-loading guard ─────────────────────────────────────────────

describe('pendingParamProcesses', () => {
  const tasks: ClientTask[] = [
    { processName: 'Alpha', params: [] },
    { processName: 'Beta', params: [] },
    { processName: '', params: [] },
  ];

  it('reports processes whose params have not been requested yet', () => {
    expect(pendingParamProcesses(tasks, {})).toEqual(['Alpha', 'Beta']);
  });

  it('reports processes whose params are still in flight', () => {
    const cache: ParamsCache = { alpha: 'loading', beta: [] };
    expect(pendingParamProcesses(tasks, cache)).toEqual(['Alpha']);
  });

  it('is empty once every process resolved (an empty param list counts as resolved)', () => {
    const cache: ParamsCache = { alpha: [], beta: [{ name: 'x', type: 'String', value: '' }] };
    expect(pendingParamProcesses(tasks, cache)).toEqual([]);
  });

  it('does not report a task without a process', () => {
    expect(pendingParamProcesses([{ processName: '', params: [] }], {})).toEqual([]);
  });

  it('deduplicates a process used by two tasks', () => {
    const twice: ClientTask[] = [{ processName: 'Alpha', params: [] }, { processName: 'Alpha', params: [] }];
    expect(pendingParamProcesses(twice, {})).toEqual(['Alpha']);
  });

  it('does not report a FAILED fetch as pending — it never resolves', () => {
    expect(pendingParamProcesses(tasks, { alpha: 'error', beta: [] })).toEqual([]);
  });
});

// ── Failed-definition guard ──────────────────────────────────────────────
// MED-3 (second half): a failed `getProcessParams` used to be cached as
// `params: []`, i.e. as a perfectly good "this process has no parameters".
// `pendingParamProcesses` then said "ready", every type fell back to '' and a
// numeric went out as a string — rejected only AFTER the tasks were deleted.

describe('failedParamProcesses', () => {
  const tasks: ClientTask[] = [
    { processName: 'Alpha', params: [] },
    { processName: 'Beta', params: [] },
    { processName: '', params: [] },
  ];

  it('reports processes whose definition could not be fetched', () => {
    expect(failedParamProcesses(tasks, { alpha: 'error', beta: [] })).toEqual(['Alpha']);
  });

  it('does not confuse a failed fetch with an empty definition', () => {
    expect(failedParamProcesses(tasks, { alpha: [], beta: [] })).toEqual([]);
  });

  it('does not report pending or unrequested processes', () => {
    expect(failedParamProcesses(tasks, { alpha: 'loading' })).toEqual([]);
    expect(failedParamProcesses(tasks, {})).toEqual([]);
  });

  it('deduplicates and skips tasks without a process', () => {
    const twice: ClientTask[] = [
      { processName: 'Alpha', params: [] },
      { processName: 'Alpha', params: [] },
      { processName: '', params: [] },
    ];
    expect(failedParamProcesses(twice, { alpha: 'error' })).toEqual(['Alpha']);
  });
});

// ── Save payload (buildAndSend) ──────────────────────────────────────────

describe('buildSaveTasks', () => {
  it('takes type AND default from the process definition, not from the chore payload', () => {
    const tasks: ClientTask[] = [{
      processName: 'Load',
      params: [{ name: 'pYear', type: 'String', value: '2025' }, { name: 'pName', type: 'String', value: 'x' }],
    }];
    const cache: ParamsCache = {
      load: [
        { name: 'pYear', type: 'Numeric', value: '1900' },
        { name: 'pName', type: 'String', value: '' },
      ],
    };
    expect(buildSaveTasks(tasks, cache)).toEqual([{
      Step: 0,
      processName: 'Load',
      Parameters: [
        { Name: 'pYear', Value: '2025', Type: 'Numeric', Default: '1900' },
        { Name: 'pName', Value: 'x', Type: 'String', Default: '' },
      ],
    }]);
  });

  it('matches the process definition case-insensitively', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'PYEAR', type: '', value: '1' }] }];
    const cache: ParamsCache = { load: [{ name: 'pYear', type: 'Numeric', value: '0' }] };
    expect(buildSaveTasks(tasks, cache)[0].Parameters[0].Type).toBe('Numeric');
  });

  it('falls back to the carried type when the process is not in the cache', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'p', type: 'Numeric', value: '1' }] }];
    expect(buildSaveTasks(tasks, {})[0].Parameters[0]).toEqual({
      Name: 'p', Value: '1', Type: 'Numeric', Default: undefined,
    });
  });

  it('renumbers Step sequentially', () => {
    const tasks: ClientTask[] = [
      { processName: 'a', params: [] },
      { processName: 'b', params: [] },
    ];
    expect(buildSaveTasks(tasks, {}).map(t => t.Step)).toEqual([0, 1]);
  });

  // MED-3: TM1 matches a chore task's parameters against the process signature
  // and rejects any count mismatch — after the tasks were already deleted.
  it('DROPS a parameter the chore carries but the process no longer defines', () => {
    const tasks: ClientTask[] = [{
      processName: 'Load',
      params: [
        { name: 'pYear', type: 'Numeric', value: '2025' },
        // Left over from an older version of the process. Never rendered (only
        // known params are), never validated (its type stays ''), but it used
        // to be sent — a guaranteed 400 the user could not see coming.
        { name: 'pObsolete', type: '', value: 'junk' },
      ],
    }];
    const cache: ParamsCache = { load: [{ name: 'pYear', type: 'Numeric', value: '1900' }] };
    expect(buildSaveTasks(tasks, cache)[0].Parameters).toEqual([
      { Name: 'pYear', Value: '2025', Type: 'Numeric', Default: '1900' },
    ]);
  });

  it('ADDS a parameter the process defines but the chore never carried, using the process default', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'pYear', type: 'Numeric', value: '2025' }] }];
    const cache: ParamsCache = {
      load: [
        { name: 'pYear', type: 'Numeric', value: '1900' },
        { name: 'pNew', type: 'String', value: 'dflt' },
      ],
    };
    expect(buildSaveTasks(tasks, cache)[0].Parameters).toEqual([
      { Name: 'pYear', Value: '2025', Type: 'Numeric', Default: '1900' },
      { Name: 'pNew', Value: 'dflt', Type: 'String', Default: 'dflt' },
    ]);
  });

  it('follows the process definition ORDER, not the order stored on the chore', () => {
    const tasks: ClientTask[] = [{
      processName: 'Load',
      params: [{ name: 'pB', type: 'String', value: 'b' }, { name: 'pA', type: 'String', value: 'a' }],
    }];
    const cache: ParamsCache = {
      load: [{ name: 'pA', type: 'String', value: '' }, { name: 'pB', type: 'String', value: '' }],
    };
    expect(buildSaveTasks(tasks, cache)[0].Parameters.map(p => p.Name)).toEqual(['pA', 'pB']);
  });

  it('sends NO parameters when the process defines none, even if the chore still stores some', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'pGone', type: '', value: 'x' }] }];
    expect(buildSaveTasks(tasks, { load: [] })[0].Parameters).toEqual([]);
  });

  it('takes the definition spelling of a parameter name', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'PYEAR', type: '', value: '1' }] }];
    const cache: ParamsCache = { load: [{ name: 'pYear', type: 'Numeric', value: '0' }] };
    expect(buildSaveTasks(tasks, cache)[0].Parameters[0].Name).toBe('pYear');
  });

  it('falls back to the chore params while the definition is loading or failed', () => {
    const tasks: ClientTask[] = [{ processName: 'Load', params: [{ name: 'p', type: 'Numeric', value: '1' }] }];
    for (const state of ['loading', 'error'] as const) {
      expect(buildSaveTasks(tasks, { load: state })[0].Parameters).toEqual([
        { Name: 'p', Value: '1', Type: 'Numeric', Default: undefined },
      ]);
    }
  });
});

// ── Frequency round-trip (setFrequency / getFrequency) ───────────────────

describe('frequency round-trip', () => {
  it('round-trips every preset', () => {
    for (const f of KNOWN_FREQS) {
      expect(formatFrequency(parseFrequency(f))).toBe(f);
    }
  });

  it('round-trips an n-days period', () => {
    expect(formatFrequency(parseFrequency('P3DT00H00M00S'))).toBe('P3DT00H00M00S');
    expect(parseFrequency('P3DT00H00M00S')).toEqual({ preset: 'days', days: '3', raw: null });
  });

  it('round-trips an UNREPRESENTABLE frequency verbatim instead of collapsing it', () => {
    // Regression: `P0DT00H05M00S` (5 min) and `P0DT03H00M00S` (3 h) both matched
    // /^P(\d+)DT/ and were rewritten to P1DT00H00M00S ("daily") on every save.
    for (const f of ['P0DT00H05M00S', 'P0DT03H00M00S', 'P0DT00H01M00S', 'P2DT12H00M00S']) {
      expect(formatFrequency(parseFrequency(f))).toBe(f);
      expect(parseFrequency(f).raw).toBe(f);
    }
  });

  it('does not treat a zero-day period as an n-days value', () => {
    expect(parseFrequency('P0DT00H05M00S').preset).toBe(DEFAULT_FREQ);
  });

  it('falls back to daily for a null/garbage frequency', () => {
    expect(formatFrequency(parseFrequency(null))).toBe(DEFAULT_FREQ);
    expect(formatFrequency(parseFrequency(undefined))).toBe(DEFAULT_FREQ);
    expect(formatFrequency(parseFrequency(''))).toBe(DEFAULT_FREQ);
  });

  it('keeps a garbage (non-ISO) value verbatim rather than losing it', () => {
    expect(formatFrequency(parseFrequency('nonsense'))).toBe('nonsense');
  });

  it('a user pick clears the preserved raw value', () => {
    const state = parseFrequency('P0DT00H05M00S');
    expect(formatFrequency({ ...state, preset: 'P0DT00H30M00S', raw: null })).toBe('P0DT00H30M00S');
  });

  it('clamps a bogus n-days input to 1 day', () => {
    expect(formatFrequency({ preset: 'days', days: '0', raw: null })).toBe('P1DT00H00M00S');
    expect(formatFrequency({ preset: 'days', days: 'abc', raw: null })).toBe('P1DT00H00M00S');
    expect(formatFrequency({ preset: 'days', days: '', raw: null })).toBe('P1DT00H00M00S');
  });
});

describe('findInvalidNumericParams', () => {
  const task = (params: ClientTask['params']): ClientTask => ({ processName: 'P', params });

  it('reports text typed into a numeric parameter', () => {
    const tasks = [task([{ name: 'pYear', type: 'Numeric', value: 'ljhljhlj' }])];
    expect(findInvalidNumericParams(tasks)).toEqual([
      { taskIdx: 0, name: 'pYear', value: 'ljhljhlj' },
    ]);
  });

  it('accepts numbers in every notation TM1 takes', () => {
    const tasks = [task([
      { name: 'a', type: 'Numeric', value: '2025' },
      { name: 'b', type: 'Numeric', value: '-3.5' },
      { name: 'c', type: 'Numeric', value: ' 42 ' },
      { name: 'd', type: 'Numeric', value: '1e3' },
    ])];
    expect(findInvalidNumericParams(tasks)).toEqual([]);
  });

  it('leaves an empty numeric alone — it falls back to the process default', () => {
    const tasks = [task([
      { name: 'a', type: 'Numeric', value: '' },
      { name: 'b', type: 'Numeric', value: '   ' },
    ])];
    expect(findInvalidNumericParams(tasks)).toEqual([]);
  });

  it('ignores string and unknown-typed parameters', () => {
    const tasks = [task([
      { name: 'a', type: 'String', value: 'ljhljhlj' },
      { name: 'b', type: '', value: 'ljhljhlj' },
    ])];
    expect(findInvalidNumericParams(tasks)).toEqual([]);
  });

  it('reports every offender across all tasks, with its task index', () => {
    const tasks = [
      task([{ name: 'a', type: 'Numeric', value: 'x' }]),
      task([{ name: 'b', type: 'Numeric', value: '7' }]),
      task([{ name: 'c', type: 'Numeric', value: 'y' }]),
    ];
    expect(findInvalidNumericParams(tasks)).toEqual([
      { taskIdx: 0, name: 'a', value: 'x' },
      { taskIdx: 2, name: 'c', value: 'y' },
    ]);
  });

  it('handles a task without parameters', () => {
    expect(findInvalidNumericParams([task([])])).toEqual([]);
  });
});
