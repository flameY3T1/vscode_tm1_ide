import { describe, it, expect } from 'vitest';
import {
  mapChoreDetailFromApi,
  buildChorePayload,
  normalizeChoreParamType,
  normalizeChoreExecutionMode,
} from '../../commands/chore/choreEditorPure';
import type { ChoreDetail } from '../../webviewClient/choreEditor/protocol';
import { buildSaveTasks, type ParamsCache } from '../../webviewClient/choreEditor/statePure';

describe('mapChoreDetailFromApi', () => {
  it('maps minimal response', () => {
    const result = mapChoreDetailFromApi({ Name: 'MyChore' });
    expect(result).toEqual({
      Name: 'MyChore',
      Active: false,
      DST: false,
      // Absent on the wire = UNKNOWN, not "the default".
      ExecutionMode: undefined,
      StartTime: null,
      Frequency: null,
      Tasks: [],
    });
  });

  it('maps ExecutionMode: both known modes are preserved verbatim', () => {
    expect(mapChoreDetailFromApi({ Name: 'C', ExecutionMode: 'SingleCommit' }).ExecutionMode).toBe('SingleCommit');
    expect(mapChoreDetailFromApi({ Name: 'C', ExecutionMode: 'MultipleCommit' }).ExecutionMode).toBe('MultipleCommit');
  });

  // The whole point of MED-1: the fallback ladder in choreApi.ts drops
  // ExecutionMode from $select on picky servers, and TM1 11.8 then answers with
  // NO ExecutionMode key at all — live-verified against a SingleCommit chore.
  // Guessing 'MultipleCommit' there rewrote the chore's transaction semantics on
  // the next save.
  it('reports an ABSENT ExecutionMode as undefined instead of guessing MultipleCommit', () => {
    expect(mapChoreDetailFromApi({ Name: 'C' }).ExecutionMode).toBeUndefined();
    expect(mapChoreDetailFromApi({ Name: 'C', ExecutionMode: null }).ExecutionMode).toBeUndefined();
    expect(mapChoreDetailFromApi({ Name: 'C', ExecutionMode: '' }).ExecutionMode).toBeUndefined();
  });

  it('reports an UNRECOGNIZED ExecutionMode as undefined too', () => {
    expect(mapChoreDetailFromApi({ Name: 'C', ExecutionMode: 'SomethingNew' }).ExecutionMode).toBeUndefined();
  });

  it('coerces Active and DSTSensitive to bool', () => {
    expect(mapChoreDetailFromApi({ Name: 'C', Active: 1, DSTSensitive: 'y' }).Active).toBe(true);
    expect(mapChoreDetailFromApi({ Name: 'C', Active: 0, DSTSensitive: 0 }).DST).toBe(false);
  });

  it('preserves StartTime + Frequency when present', () => {
    const r = mapChoreDetailFromApi({ Name: 'C', StartTime: '2025-01-01T00:00:00Z', Frequency: 'P1DT0H0M0S' });
    expect(r.StartTime).toBe('2025-01-01T00:00:00Z');
    expect(r.Frequency).toBe('P1DT0H0M0S');
  });

  it('falls back to null for missing time/frequency', () => {
    const r = mapChoreDetailFromApi({ Name: 'C' });
    expect(r.StartTime).toBeNull();
    expect(r.Frequency).toBeNull();
  });

  it('maps Tasks with Step from index when missing', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [
        { Process: { Name: 'p1' }, Parameters: [] },
        { Process: { Name: 'p2' }, Parameters: [] },
      ],
    });
    expect(r.Tasks).toHaveLength(2);
    expect(r.Tasks[0]).toMatchObject({ Step: 0, processName: 'p1' });
    expect(r.Tasks[1]).toMatchObject({ Step: 1, processName: 'p2' });
  });

  it('uses provided Step when set', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Step: 42, Process: { Name: 'p' }, Parameters: [] }],
    });
    expect(r.Tasks[0].Step).toBe(42);
  });

  it('maps Parameters with type coercion (Numeric)', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'N', Type: 1, Value: 5 }] }],
    });
    expect(r.Tasks[0].Parameters[0]).toEqual({ Name: 'N', Type: 'Numeric', Value: '5' });
  });

  it('maps Parameters with type coercion (Numeric string)', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'N', Type: 'Numeric', Value: 5 }] }],
    });
    expect(r.Tasks[0].Parameters[0].Type).toBe('Numeric');
  });

  it('defaults Parameter type to String', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'S', Type: 2, Value: 'x' }] }],
    });
    expect(r.Tasks[0].Parameters[0].Type).toBe('String');
  });

  it('coerces null/undefined Parameter value to empty string', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'N', Type: 1, Value: null }] }],
    });
    expect(r.Tasks[0].Parameters[0].Value).toBe('');
  });

  it('handles missing Process.Name as empty processName', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Parameters: [] }],
    });
    expect(r.Tasks[0].processName).toBe('');
  });

  it('handles missing Parameters array', () => {
    const r = mapChoreDetailFromApi({
      Name: 'C',
      Tasks: [{ Process: { Name: 'p' } }],
    });
    expect(r.Tasks[0].Parameters).toEqual([]);
  });

  // The fixtures above all supply `Type`. Live TM1 (11.8) frequently does NOT —
  // which is what silently turned every numeric chore parameter into a string.
  describe('task parameter WITHOUT a Type (the live case)', () => {
    it('infers Numeric from a JSON number value', () => {
      const r = mapChoreDetailFromApi({
        Name: 'C',
        Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'pYear', Value: 2025 }] }],
      });
      expect(r.Tasks[0].Parameters[0]).toEqual({ Name: 'pYear', Type: 'Numeric', Value: '2025' });
    });

    it('reports UNKNOWN ("") instead of guessing String for a string value', () => {
      const r = mapChoreDetailFromApi({
        Name: 'C',
        Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'pAny', Value: '5' }] }],
      });
      expect(r.Tasks[0].Parameters[0].Type).toBe('');
    });

    it('reports UNKNOWN ("") for a null value', () => {
      const r = mapChoreDetailFromApi({
        Name: 'C',
        Tasks: [{ Process: { Name: 'p' }, Parameters: [{ Name: 'pAny', Value: null }] }],
      });
      expect(r.Tasks[0].Parameters[0]).toEqual({ Name: 'pAny', Type: '', Value: '' });
    });
  });
});

describe('normalizeChoreExecutionMode', () => {
  it('honours both modes TM1 knows', () => {
    expect(normalizeChoreExecutionMode('SingleCommit')).toBe('SingleCommit');
    expect(normalizeChoreExecutionMode('MultipleCommit')).toBe('MultipleCommit');
  });

  it('returns undefined (UNKNOWN) for anything the server did not report', () => {
    expect(normalizeChoreExecutionMode(undefined)).toBeUndefined();
    expect(normalizeChoreExecutionMode(null)).toBeUndefined();
    expect(normalizeChoreExecutionMode('')).toBeUndefined();
    expect(normalizeChoreExecutionMode(0)).toBeUndefined();
    expect(normalizeChoreExecutionMode('singlecommit')).toBeUndefined();
  });
});

describe('normalizeChoreParamType', () => {
  it('honours an explicit numeric type in both encodings', () => {
    expect(normalizeChoreParamType(1, 'x')).toBe('Numeric');
    expect(normalizeChoreParamType('Numeric', 'x')).toBe('Numeric');
  });

  it('honours an explicit string type in both encodings', () => {
    expect(normalizeChoreParamType(2, 5)).toBe('String');
    expect(normalizeChoreParamType('String', 5)).toBe('String');
  });

  it('infers Numeric from a JSON number when the type is missing', () => {
    expect(normalizeChoreParamType(undefined, 0)).toBe('Numeric');
    expect(normalizeChoreParamType(null, -2.5)).toBe('Numeric');
  });

  it('returns "" (unknown) rather than guessing', () => {
    expect(normalizeChoreParamType(undefined, 'x')).toBe('');
    expect(normalizeChoreParamType(undefined, undefined)).toBe('');
    expect(normalizeChoreParamType(99, 'x')).toBe('');
  });
});

describe('buildChorePayload', () => {
  const base: ChoreDetail = {
    Name: 'TestChore',
    Active: true,
    DST: false,
    ExecutionMode: 'MultipleCommit',
    StartTime: '2025-06-01T12:00:00Z',
    Frequency: 'P0DT01H00M00S',
    Tasks: [],
  };

  it('builds payload with required fields', () => {
    const r = buildChorePayload(base);
    expect(r.Name).toBe('TestChore');
    expect(r.Active).toBe(true);
    expect(r.StartTime).toBe('2025-06-01T12:00:00Z');
    expect(r.Frequency).toBe('P0DT01H00M00S');
    expect(r.Tasks).toEqual([]);
  });

  it('emits ExecutionMode + DSTSensitive into payload', () => {
    expect(buildChorePayload({ ...base, ExecutionMode: 'SingleCommit', DST: true }))
      .toMatchObject({ ExecutionMode: 'SingleCommit', DSTSensitive: true });
    expect(buildChorePayload(base)).toMatchObject({ ExecutionMode: 'MultipleCommit', DSTSensitive: false });
  });

  // MED-1: an UNKNOWN mode must not be written back. PATCH only touches the
  // fields it is given, so omitting the key leaves the chore's transaction
  // semantics alone — sending 'MultipleCommit' would downgrade a SingleCommit
  // chore that this server simply never reported.
  it('OMITS ExecutionMode entirely when the mode is unknown', () => {
    const payload = buildChorePayload({ ...base, ExecutionMode: undefined });
    expect('ExecutionMode' in payload).toBe(false);
    expect(payload.Name).toBe('TestChore');
    // Everything else still goes out.
    expect(payload).toMatchObject({ Active: true, DSTSensitive: false });
  });

  it('does not send an ExecutionMode key for a chore loaded through the reduced ladder variant', () => {
    // Exactly what TM1 11.8 answers for
    // `$select=Name,Active,DSTSensitive,StartTime,Frequency` — the last two
    // ladder variants. The chore's REAL mode is SingleCommit.
    const loaded = mapChoreDetailFromApi({
      Name: 'Nightly', Active: true, DSTSensitive: false,
      StartTime: '2025-01-01T00:00:00Z', Frequency: 'P1DT00H00M00S',
      Tasks: [],
    });
    expect(loaded.ExecutionMode).toBeUndefined();
    expect('ExecutionMode' in buildChorePayload(loaded)).toBe(false);
  });

  it('applies StartTime default when null', () => {
    const r = buildChorePayload({ ...base, StartTime: null });
    expect(r.StartTime).toBe('2024-01-01T00:00:00Z');
  });

  it('applies Frequency default when null', () => {
    const r = buildChorePayload({ ...base, Frequency: null });
    expect(r.Frequency).toBe('P1DT00H00M00S');
  });

  it('assigns sequential Step indices to tasks', () => {
    const r = buildChorePayload({
      ...base,
      Tasks: [
        { Step: 99, processName: 'a', Parameters: [] },
        { Step: 99, processName: 'b', Parameters: [] },
      ],
    });
    expect((r.Tasks as Array<{ Step: number }>)[0].Step).toBe(0);
    expect((r.Tasks as Array<{ Step: number }>)[1].Step).toBe(1);
  });

  it('binds Process via OData reference with encoding', () => {
    const r = buildChorePayload({
      ...base,
      Tasks: [{ Step: 0, processName: 'p with spaces', Parameters: [] }],
    });
    expect((r.Tasks as Array<Record<string, string>>)[0]['Process@odata.bind'])
      .toBe("Processes('p%20with%20spaces')");
  });

  it('coerces numerics to JSON numbers, empty numeric → default, keeps all params', () => {
    const r = buildChorePayload({
      ...base,
      Tasks: [{
        Step: 0, processName: 'p',
        Parameters: [
          { Name: 'nSet', Type: 'Numeric', Value: '5' },
          { Name: 'nEmpty', Type: 'Numeric', Value: '', Default: '1000' },
          { Name: 'nEmptyNoDef', Type: 'Numeric', Value: '' },
          { Name: 'nZero', Type: 'Numeric', Value: '0' },
          { Name: 'nNeg', Type: 'Numeric', Value: '-2.5' },
          { Name: 'sEmpty', Type: 'String', Value: '' },
          { Name: 'sSet', Type: 'String', Value: 'x' },
        ],
      }],
    });
    const params = (r.Tasks as Array<{ Parameters: Array<{ Name: string; Value: unknown }> }>)[0].Parameters;
    // Count preserved (TM1 requires all params) and numerics are numbers.
    expect(params).toEqual([
      { Name: 'nSet', Value: 5 },
      { Name: 'nEmpty', Value: 1000 },    // empty numeric → process default
      { Name: 'nEmptyNoDef', Value: 0 },  // empty numeric, no default → 0 (TM1-valid, live-verified)
      { Name: 'nZero', Value: 0 },
      { Name: 'nNeg', Value: -2.5 },      // negatives / decimals pass through
      { Name: 'sEmpty', Value: '' },      // empty String stays "" (valid)
      { Name: 'sSet', Value: 'x' },
    ]);
  });

  it('flattens parameters to Name/Value pairs', () => {
    const r = buildChorePayload({
      ...base,
      Tasks: [{
        Step: 0,
        processName: 'p',
        Parameters: [
          { Name: 'X', Type: 'Numeric', Value: '5' },
          { Name: 'Y', Type: 'String', Value: 'hello' },
        ],
      }],
    });
    expect((r.Tasks as Array<{ Parameters: unknown }>)[0].Parameters).toEqual([
      { Name: 'X', Value: 5 },          // Numeric coerced to a JSON number
      { Name: 'Y', Value: 'hello' },
    ]);
  });

  it('handles task with undefined Parameters', () => {
    const r = buildChorePayload({
      ...base,
      Tasks: [{ Step: 0, processName: 'p', Parameters: undefined as unknown as never }],
    });
    expect((r.Tasks as Array<{ Parameters: unknown[] }>)[0].Parameters).toEqual([]);
  });
});

// The reported bug end to end: open a chore, change nothing, save.
describe('load → save round-trip of an UNCHANGED chore', () => {
  it('sends a numeric parameter as a JSON number even though TM1 reported no Type', () => {
    // 1) What TM1 11.8 actually returns for a chore task parameter: no `Type`.
    const loaded = mapChoreDetailFromApi({
      Name: 'Nightly',
      Active: true,
      ExecutionMode: 'SingleCommit',
      StartTime: '2025-01-01T00:00:00Z',
      Frequency: 'P0DT00H05M00S',
      Tasks: [{ Step: 0, Process: { Name: 'Load' }, Parameters: [{ Name: 'pYear', Value: '2025' }] }],
    });
    expect(loaded.Tasks[0].Parameters[0].Type).toBe('');
    expect(loaded.ExecutionMode).toBe('SingleCommit');
    expect(loaded.Frequency).toBe('P0DT00H05M00S');

    // 2) The webview renders the rows from the PROCESS definition and rebuilds
    //    the payload from it — that is where the real type comes from.
    const clientTasks = loaded.Tasks.map(t => ({
      processName: t.processName,
      params: t.Parameters.map(p => ({ name: p.Name, type: p.Type, value: p.Value })),
    }));
    const cache: ParamsCache = { load: [{ name: 'pYear', type: 'Numeric', value: '1900' }] };
    const saveTasks = buildSaveTasks(clientTasks, cache);
    expect(saveTasks[0].Parameters[0].Type).toBe('Numeric');

    // 3) The extension coerces it to a JSON number, which is what TM1 accepts.
    const payload = buildChorePayload({
      ...loaded,
      Tasks: saveTasks.map(t => ({
        Step: t.Step,
        processName: t.processName,
        Parameters: t.Parameters.map(p => ({ Name: p.Name, Type: p.Type, Value: p.Value, Default: p.Default })),
      })),
    });
    const params = (payload.Tasks as Array<{ Parameters: Array<{ Name: string; Value: unknown }> }>)[0].Parameters;
    expect(params).toEqual([{ Name: 'pYear', Value: 2025 }]);
    // …and the two adjacent fields survive the round-trip too.
    expect(payload.ExecutionMode).toBe('SingleCommit');
    expect(payload.Frequency).toBe('P0DT00H05M00S');
  });

  it('would have sent the numeric as a STRING without the process-definition type', () => {
    // Guards the regression: with an empty cache the unknown type stays unknown
    // and coerceChoreParamValue treats it as a string — exactly the 400 the user hit.
    const clientTasks = [{ processName: 'Load', params: [{ name: 'pYear', type: '', value: '2025' }] }];
    const saveTasks = buildSaveTasks(clientTasks, {});
    const payload = buildChorePayload({
      Name: 'C', Active: false, DST: false, ExecutionMode: 'MultipleCommit',
      StartTime: null, Frequency: null,
      Tasks: saveTasks.map(t => ({
        Step: t.Step,
        processName: t.processName,
        Parameters: t.Parameters.map(p => ({ Name: p.Name, Type: p.Type, Value: p.Value })),
      })),
    });
    const params = (payload.Tasks as Array<{ Parameters: Array<{ Value: unknown }> }>)[0].Parameters;
    expect(params[0].Value).toBe('2025');
  });
});
