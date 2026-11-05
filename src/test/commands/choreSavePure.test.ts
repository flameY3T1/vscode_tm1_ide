import { describe, it, expect } from 'vitest';
import {
  saveChore,
  saveChoreAs,
  repairParamTypes,
  ChoreSaveError,
  type ChoreSaveDeps,
} from '../../commands/chore/choreSavePure';
import type { ChoreDetail } from '../../webviewClient/choreEditor/protocol';

type Call = [string, ...unknown[]];

interface Harness {
  deps: ChoreSaveDeps;
  calls: Call[];
  logs: string[];
}

interface HarnessOpts {
  /** Server state the snapshot / read-back returns. */
  server?: ChoreDetail | null;
  /** Fail `updateChore` on the n-th call (1-based). */
  failUpdateOn?: number;
  /** Fail every `updateChore` from the n-th call on (used for rollback failure). */
  failUpdateFrom?: number;
  /** Make every chore read throw. */
  readThrows?: boolean;
  /** Make only the read-back (2nd read) throw. */
  readBackThrows?: boolean;
  processParams?: Record<string, Array<{ name: string; type: string }>>;
}

function chore(over: Partial<ChoreDetail> = {}): ChoreDetail {
  return {
    Name: 'Nightly',
    Active: true,
    DST: false,
    ExecutionMode: 'MultipleCommit',
    StartTime: '2025-01-01T00:00:00Z',
    Frequency: 'P1DT00H00M00S',
    Tasks: [{ Step: 0, processName: 'Load', Parameters: [{ Name: 'pYear', Type: 'Numeric', Value: '2025' }] }],
    ...over,
  };
}

function harness(opts: HarnessOpts = {}): Harness {
  const calls: Call[] = [];
  const logs: string[] = [];
  let updates = 0;
  let reads = 0;
  const deps: ChoreSaveDeps = {
    createChore: async body => { calls.push(['createChore', body]); },
    updateChore: async (name, body) => {
      updates++;
      calls.push(['updateChore', name, body]);
      if (opts.failUpdateOn === updates) { throw new Error(`PATCH rejected (#${updates})`); }
      if (opts.failUpdateFrom !== undefined && updates >= opts.failUpdateFrom) {
        throw new Error(`PATCH rejected (#${updates})`);
      }
    },
    clearChoreTasks: async name => { calls.push(['clearChoreTasks', name]); },
    readChore: async name => {
      reads++;
      calls.push(['readChore', name]);
      if (opts.readThrows) { throw new Error('read failed'); }
      if (opts.readBackThrows && reads > 1) { throw new Error('read-back failed'); }
      return opts.server ?? chore();
    },
    readProcessParams: async p => {
      calls.push(['readProcessParams', p]);
      return opts.processParams?.[p] ?? [];
    },
    log: m => logs.push(m),
  };
  return { deps, calls, logs };
}

const names = (calls: Call[]): string[] => calls.map(c => c[0]);

describe('saveChore — new chore', () => {
  it('POSTs once and does not touch the task-clearing path', async () => {
    const h = harness();
    const out = await saveChore(h.deps, { isNew: true, originalName: '', choreData: chore() });
    expect(names(h.calls)).toEqual(['createChore']);
    expect(out).toEqual({ sentTasks: 1, storedTasks: 1 });
  });
});

describe('saveChoreAs', () => {
  it('POSTs once under the target name and touches nothing destructive', async () => {
    const h = harness();
    const out = await saveChoreAs(h.deps, { targetName: 'Nightly_copy', choreData: chore({ Active: false }) });
    expect(names(h.calls)).toEqual(['createChore']);
    expect(names(h.calls)).not.toContain('clearChoreTasks');
    expect(names(h.calls)).not.toContain('updateChore');
    const body = h.calls[0][1] as { Name: string; Active: boolean; Tasks: unknown[] };
    expect(body.Name).toBe('Nightly_copy');
    expect(body.Tasks).toHaveLength(1);
    expect(out).toEqual({ activated: false });
  });

  it('POSTs the copy INACTIVE even when the source is active', async () => {
    const h = harness();
    await saveChoreAs(h.deps, { targetName: 'Nightly_copy', choreData: chore({ Active: true }) });
    expect((h.calls[0][1] as { Active: boolean }).Active).toBe(false);
  });

  it('activates the copy only after it exists, when the source was active', async () => {
    const h = harness();
    const out = await saveChoreAs(h.deps, { targetName: 'Nightly_copy', choreData: chore({ Active: true }) });
    expect(names(h.calls)).toEqual(['createChore', 'updateChore']);
    expect(h.calls[1]).toEqual(['updateChore', 'Nightly_copy', { Active: true }]);
    expect(out).toEqual({ activated: true });
  });

  it('reports a failed activation instead of throwing — the copy itself exists', async () => {
    const h = harness({ failUpdateOn: 1 });
    const out = await saveChoreAs(h.deps, { targetName: 'Nightly_copy', choreData: chore({ Active: true }) });
    expect(out.activated).toBe(false);
    expect(out.activateError).toMatch(/PATCH rejected/);
    expect(h.logs.join('\n')).toMatch(/could not be activated/);
  });

  it('propagates a failing create', async () => {
    const h = harness();
    const deps: ChoreSaveDeps = { ...h.deps, createChore: async () => { throw new Error('POST rejected'); } };
    await expect(saveChoreAs(deps, { targetName: 'X', choreData: chore() })).rejects.toThrow(/POST rejected/);
  });
});

describe('saveChore — existing chore, happy path', () => {
  it('snapshots BEFORE clearing, then deactivate → clear → write → reactivate → read back', async () => {
    const h = harness();
    const out = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() });
    expect(names(h.calls)).toEqual([
      'readChore',        // snapshot — must precede anything destructive
      'updateChore',      // deactivate
      'clearChoreTasks',  // destructive
      'updateChore',      // write tasks (inactive)
      'updateChore',      // restore Active=true
      'readChore',        // verification read-back
    ]);
    expect(h.calls[0]).toEqual(['readChore', 'Nightly']);
    expect(h.calls[1]).toEqual(['updateChore', 'Nightly', { Active: false }]);
    expect(h.calls[4]).toEqual(['updateChore', 'Nightly', { Active: true }]);
    expect(out).toEqual({ sentTasks: 1, storedTasks: 1 });
  });

  it('writes the task payload with Active:false — TM1 refuses task edits on an active chore', async () => {
    const h = harness();
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() });
    const body = h.calls[3][2] as Record<string, unknown>;
    expect(body.Active).toBe(false);
    expect(body.Tasks).toHaveLength(1);
  });

  it('skips the reactivation PATCH when the chore is meant to stay inactive', async () => {
    const h = harness();
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore({ Active: false }) });
    expect(names(h.calls)).toEqual(['readChore', 'updateChore', 'clearChoreTasks', 'updateChore', 'readChore']);
  });

  it('sends a numeric parameter as a JSON number', async () => {
    const h = harness();
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() });
    const body = h.calls[3][2] as { Tasks: Array<{ Parameters: Array<{ Value: unknown }> }> };
    expect(body.Tasks[0].Parameters[0].Value).toBe(2025);
  });
});

describe('saveChore — read-back verification', () => {
  it('reports the server task count so the caller can warn on a partial save', async () => {
    const h = harness({ server: chore({ Tasks: [] }) });
    const out = await saveChore(h.deps, {
      isNew: false, originalName: 'Nightly',
      choreData: chore({ Tasks: [
        { Step: 0, processName: 'A', Parameters: [] },
        { Step: 1, processName: 'B', Parameters: [] },
      ] }),
    });
    expect(out.sentTasks).toBe(2);
    expect(out.storedTasks).toBe(0);
  });

  it('surfaces a failed read-back as storedTasks:-1 without failing the save', async () => {
    const h = harness({ readBackThrows: true });
    const out = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() });
    expect(out.storedTasks).toBe(-1);
    expect(out.readBackError).toMatch(/read-back failed/);
  });
});

describe('saveChore — failure + rollback', () => {
  it('rolls the captured tasks back when the writing PATCH is rejected', async () => {
    // update #1 = deactivate, #2 = write tasks → fail there.
    const h = harness({ failUpdateOn: 2 });
    const err = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() })
      .then(() => null, (e: unknown) => e as ChoreSaveError);
    expect(err).toBeInstanceOf(ChoreSaveError);
    expect(err!.rollback).toBe('restored');
    expect(err!.detail).toMatch(/PATCH rejected/);
    expect(names(h.calls)).toEqual([
      'readChore', 'updateChore', 'clearChoreTasks', 'updateChore',
      // rollback: deactivate → clear the half-written list → restore → reactivate
      'updateChore', 'clearChoreTasks', 'updateChore', 'updateChore',
    ]);
  });

  it('restores the ORIGINAL Active flag, not the one the user asked for', async () => {
    const h = harness({ server: chore({ Active: false }), failUpdateOn: 2 });
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore({ Active: true }) })
      .catch(() => undefined);
    // Rollback must NOT end with a reactivating PATCH when the snapshot was inactive.
    const rollback = h.calls.slice(4);
    expect(names(rollback)).toEqual(['updateChore', 'clearChoreTasks', 'updateChore']);
  });

  it('restores the captured tasks verbatim', async () => {
    const server = chore({ Tasks: [
      { Step: 0, processName: 'Old1', Parameters: [] },
      { Step: 1, processName: 'Old2', Parameters: [] },
    ] });
    const h = harness({ server, failUpdateOn: 2 });
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() }).catch(() => undefined);
    const restoreBody = h.calls[6][2] as { Tasks: Array<Record<string, string>> };
    expect(restoreBody.Tasks.map(t => t['Process@odata.bind'])).toEqual([
      "Processes('Old1')", "Processes('Old2')",
    ]);
  });

  it('reports rollback:"failed" when the restore itself is rejected', async () => {
    // #1 deactivate ok, #2 write tasks fails, #3+ (rollback) also fail.
    const h = harness({ failUpdateFrom: 2 });
    const err = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() })
      .then(() => null, (e: unknown) => e as ChoreSaveError);
    expect(err!.rollback).toBe('failed');
    expect(err!.rollbackDetail).toMatch(/PATCH rejected/);
    expect(h.logs.join('\n')).toMatch(/rollback of "Nightly" FAILED/);
  });

  it('ABORTS before anything destructive when the snapshot could not be read', async () => {
    const h = harness({ readThrows: true, failUpdateOn: 2 });
    const err = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() })
      .then(() => null, (e: unknown) => e as ChoreSaveError);
    // Without a snapshot there is nothing to restore from, so the save must not
    // start at all: refusing leaves the chore intact, starting blind would empty
    // it irrecoverably.
    expect(err).toBeInstanceOf(ChoreSaveError);
    expect(err!.rollback).toBe('not-needed');
    expect(names(h.calls)).toEqual(['readChore']);
    expect(names(h.calls)).not.toContain('clearChoreTasks');
    expect(h.logs.join('\n')).toMatch(/save aborted, chore untouched/);
  });

  it('reports rollback:"not-needed" when the very first deactivation fails', async () => {
    const h = harness({ failUpdateOn: 1 });
    const err = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() })
      .then(() => null, (e: unknown) => e as ChoreSaveError);
    expect(err!.rollback).toBe('not-needed');
    // Crucially: clearChoreTasks was never reached.
    expect(names(h.calls)).toEqual(['readChore', 'updateChore']);
  });

  it('rolls back when clearChoreTasks itself throws', async () => {
    const h = harness();
    h.deps.clearChoreTasks = async name => {
      h.calls.push(['clearChoreTasks', name]);
      throw new Error('DELETE Tasks(0) rejected');
    };
    const err = await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() })
      .then(() => null, (e: unknown) => e as ChoreSaveError);
    expect(err!.detail).toMatch(/DELETE Tasks\(0\) rejected/);
    expect(err!.rollback).toBe('failed'); // the rollback re-uses the same broken clear
  });
});

describe('repairParamTypes', () => {
  const deps = (params: Record<string, Array<{ name: string; type: string }>>): ChoreSaveDeps =>
    harness({ processParams: params }).deps;

  it('fills an unknown type from the process definition', async () => {
    const detail = chore({ Tasks: [{
      Step: 0, processName: 'Load',
      Parameters: [{ Name: 'pYear', Type: '', Value: '2025' }, { Name: 'pName', Type: '', Value: 'x' }],
    }] });
    const out = await repairParamTypes(detail, deps({
      Load: [{ name: 'pYear', type: 'Numeric' }, { name: 'pName', type: 'String' }],
    }));
    expect(out.Tasks[0].Parameters.map(p => p.Type)).toEqual(['Numeric', 'String']);
  });

  it('leaves a known type alone', async () => {
    const detail = chore({ Tasks: [{
      Step: 0, processName: 'Load', Parameters: [{ Name: 'pYear', Type: 'String', Value: 'x' }],
    }] });
    const out = await repairParamTypes(detail, deps({ Load: [{ name: 'pYear', type: 'Numeric' }] }));
    expect(out.Tasks[0].Parameters[0].Type).toBe('String');
  });

  it('does not call the server when nothing needs repairing', async () => {
    const h = harness();
    const before = h.calls.length;
    await repairParamTypes(chore(), h.deps);
    expect(h.calls.length).toBe(before);
  });

  it('fetches each process only once', async () => {
    const h = harness({ processParams: { Load: [{ name: 'p', type: 'Numeric' }] } });
    const detail = chore({ Tasks: [
      { Step: 0, processName: 'Load', Parameters: [{ Name: 'p', Type: '', Value: '1' }] },
      { Step: 1, processName: 'Load', Parameters: [{ Name: 'p', Type: '', Value: '2' }] },
    ] });
    await repairParamTypes(detail, h.deps);
    expect(h.calls.filter(c => c[0] === 'readProcessParams')).toHaveLength(1);
  });

  it('keeps the unknown type when the process cannot be read', async () => {
    const h = harness();
    h.deps.readProcessParams = async () => { throw new Error('no such process'); };
    const detail = chore({ Tasks: [{
      Step: 0, processName: 'Gone', Parameters: [{ Name: 'p', Type: '', Value: '1' }],
    }] });
    const out = await repairParamTypes(detail, h.deps);
    expect(out.Tasks[0].Parameters[0].Type).toBe('');
    expect(h.logs.join('\n')).toMatch(/parameter types of process "Gone" unavailable/);
  });
});

describe('saveChore — snapshot type repair', () => {
  it('repairs the snapshot types so the rollback payload sends numbers, not strings', async () => {
    // Server reports the task parameter WITHOUT a type (the real 11.8 behaviour).
    const server = chore({ Tasks: [{
      Step: 0, processName: 'Load', Parameters: [{ Name: 'pYear', Type: '', Value: '2024' }],
    }] });
    const h = harness({ server, failUpdateOn: 2, processParams: { Load: [{ name: 'pYear', type: 'Numeric' }] } });
    await saveChore(h.deps, { isNew: false, originalName: 'Nightly', choreData: chore() }).catch(() => undefined);
    const restoreIdx = h.calls.findIndex((c, i) => c[0] === 'updateChore' && i > 5 && !!(c[2] as { Tasks?: unknown }).Tasks);
    const restore = h.calls[restoreIdx][2] as { Tasks: Array<{ Parameters: Array<{ Value: unknown }> }> };
    expect(restore.Tasks[0].Parameters[0].Value).toBe(2024);
  });
});
