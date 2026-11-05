import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', async () => await import('./__mocks__/vscode'));

vi.mock('../tm1Rest/threadApi', () => ({
  findExecutionThreadId: vi.fn(),
  cancelThread: vi.fn(),
  findExecutionJobId: vi.fn(),
  cancelJob: vi.fn(),
}));

import { findExecutionThreadId, cancelThread, findExecutionJobId, cancelJob } from '../tm1Rest/threadApi';
import { runCancellableProcess, runCancellableExecution, isCancelRejection } from '../runState/runCancellableProcess';
import { onDidChangeRuns, listRuns, cancelRun, _clearRunsForTest } from '../runState/runRegistry';

describe('runCancellableProcess', () => {
  const armed: Array<{ dispose: () => void }> = [];

  /**
   * Cancels the run the moment it registers — the stand-in for the user hitting
   * the stop button in the "Running" view while the op is still pending.
   * `startRun` fires synchronously before `op()` is awaited, so this lands in
   * the same window the old progress-token stub used to hit.
   */
  function armAutoCancel(): void {
    let fired = false;
    const sub = onDidChangeRuns(() => {
      const run = listRuns()[0];
      if (fired || !run) { return; }
      fired = true;
      cancelRun(run.id);
    });
    armed.push(sub);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _clearRunsForTest();
  });

  afterEach(() => {
    armed.splice(0).forEach(s => s.dispose());
  });

  /**
   * A still-RUNNING op: resolves on a macrotask, i.e. after the (microtask)
   * lookup+cancel roundtrip. Anything that resolves earlier is a FINISHED run,
   * for which no cancel may go out any more — see the stale-cancel block below.
   */
  const runningOp = <T>(value: T) => () => new Promise<T>(r => setTimeout(() => r(value), 0));

  it('returns the op result and cancelled=false on normal completion', async () => {
    const { result, cancelled } = await runCancellableProcess(
      'title', 'Proc', undefined as never, async () => ({ status: 'Successful' }),
    );
    expect(cancelled).toBe(false);
    expect(result).toEqual({ status: 'Successful' });
    expect(cancelThread).not.toHaveBeenCalled();
  });

  it('on cancel, finds the running thread and cancels it server-side', async () => {
    (findExecutionThreadId as any).mockResolvedValue(42);
    armAutoCancel(); // user hits stop in the "Running" view before the op resolves

    const cfg = { serverUrl: 'http://s' } as any;
    const { cancelled } = await runCancellableProcess('t', 'MyProc', cfg, runningOp({ status: '' }));

    expect(cancelled).toBe(true);
    expect(findExecutionThreadId).toHaveBeenCalledWith('Processes', 'MyProc', cfg, undefined);
    expect(cancelThread).toHaveBeenCalledWith(cfg, 42);
  });

  it('on cancel with no running thread, does not call cancelThread', async () => {
    (findExecutionThreadId as any).mockResolvedValue(undefined);
    armAutoCancel();

    // The click alone is NOT a cancellation: nothing was killed, the run simply
    // finished on its own — reporting `cancelled` would be a lie to the caller.
    const { cancelled } = await runCancellableProcess('t', 'Gone', undefined as never, async () => ({}));
    expect(cancelled).toBe(false);
    expect(cancelThread).not.toHaveBeenCalled();
  });

  it('runCancellableExecution passes the Chores kind through on cancel', async () => {
    (findExecutionThreadId as any).mockResolvedValue(77);
    armAutoCancel();

    const cfg = { serverUrl: 'http://s' } as any;
    await runCancellableExecution('t', 'Chores', 'MyChore', cfg, runningOp({}));
    expect(findExecutionThreadId).toHaveBeenCalledWith('Chores', 'MyChore', cfg, undefined);
    expect(cancelThread).toHaveBeenCalledWith(cfg, 77);
  });

  it('a cancelled token (notebook cell Stop) kills the server thread like the Running view does', async () => {
    (findExecutionThreadId as any).mockResolvedValue(9);
    let fire: (() => void) | undefined;
    const token = { isCancellationRequested: false, onCancellationRequested: (l: () => void) => { fire = l; return { dispose() { fire = undefined; } }; } };
    const cfg = { serverUrl: 'http://s' } as any;
    const p = runCancellableProcess('t', 'P', cfg, runningOp({}), { includeTransient: true, token });
    fire!();
    const { cancelled } = await p;
    expect(cancelled).toBe(true);
    expect(findExecutionThreadId).toHaveBeenCalledWith('Processes', 'P', cfg, expect.objectContaining({ includeTransient: true }));
    expect(cancelThread).toHaveBeenCalledWith(cfg, 9);
    expect(fire).toBeUndefined(); // listener disposed with the run
  });

  /** Alias kept for readability at the call sites below. */
  const cancelImmediately = armAutoCancel;

  it('cancels a v12 run through Jobs — v12 has no /Threads', async () => {
    (findExecutionJobId as any).mockResolvedValue('f7308ee4-…-00');
    cancelImmediately();

    const cfg = { serverUrl: 'http://s', version: 'v12' } as any;
    const { cancelled } = await runCancellableProcess('t', 'MyProc', cfg, runningOp({}), { includeTransient: true });

    expect(cancelled).toBe(true);
    expect(findExecutionJobId).toHaveBeenCalledWith('Processes', 'MyProc', cfg, { includeTransient: true });
    expect(cancelJob).toHaveBeenCalledWith(cfg, 'f7308ee4-…-00');
    expect(findExecutionThreadId).not.toHaveBeenCalled();
    expect(cancelThread).not.toHaveBeenCalled();
  });

  it('does not touch the thread path on v12 when no job matches', async () => {
    (findExecutionJobId as any).mockResolvedValue(undefined);
    cancelImmediately();

    await runCancellableProcess('t', 'Gone', { serverUrl: 'http://s', version: 'v12' } as any, async () => ({}));
    expect(cancelJob).not.toHaveBeenCalled();
    expect(cancelThread).not.toHaveBeenCalled();
  });

  it('swallows the op rejection caused by the cancel itself', async () => {
    // The killed run reports 500 back to the pending execute call — that is the
    // expected result of the user's click, not an error to surface.
    (findExecutionThreadId as any).mockResolvedValue(42);
    cancelImmediately();

    const { result, cancelled } = await runCancellableProcess(
      't', 'MyProc', { serverUrl: 'http://s' } as any,
      async () => { throw new Error('HTTP 500: TM1UserException: Cancel'); },
    );
    expect(cancelled).toBe(true);
    expect(result).toBeUndefined();
  });

  it('still propagates a failure when the user did not cancel', async () => {
    await expect(runCancellableProcess(
      't', 'MyProc', { serverUrl: 'http://s' } as any,
      async () => { throw new Error('HTTP 500: boom'); },
    )).rejects.toThrow('boom');
  });
  it.each(['HTTP 500: TM1UserException: CancelledLookup', 'HTTP 500: Der Vorgang wurde abgebrochen wegen eines Konfigurationsfehlers'])('does not classify an unrelated error as external cancellation: %s', async message => {
    await expect(runCancellableProcess('t', 'Proc', { serverUrl: 'http://s' } as never,
      async () => { throw new Error(message); })).rejects.toThrow(message);
  });

  describe('only an ISSUED cancel may swallow the failure', () => {
    // `cancelled = true` on the mere click hid every unrelated failure (HTTP 500,
    // transport error) behind a "was cancelled" toast, although the run kept
    // going and then died for its own reason.

    it('propagates the real error when no thread was found to cancel', async () => {
      (findExecutionThreadId as any).mockResolvedValue(undefined);
      cancelImmediately();

      await expect(runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error('HTTP 500: boom'); },
      )).rejects.toThrow('boom');
    });

    it('propagates the real error when the cancel call itself failed', async () => {
      (findExecutionThreadId as any).mockResolvedValue(42);
      // `Once`: vi.clearAllMocks() resets calls but KEEPS implementations, so a
      // permanent rejection would leak into the following tests.
      (cancelThread as any).mockRejectedValueOnce(new Error('cancel refused'));
      cancelImmediately();

      await expect(runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error('HTTP 500: boom'); },
      )).rejects.toThrow('boom');
    });

    it('propagates the real error when no v12 job was found to cancel', async () => {
      (findExecutionJobId as any).mockResolvedValue(undefined);
      cancelImmediately();

      await expect(runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s', version: 'v12' } as any,
        async () => { throw new Error('HTTP 500: boom'); },
      )).rejects.toThrow('boom');
    });

    it('waits for a still-pending cancel before judging the rejection', async () => {
      // The op can reject while the lookup/cancel roundtrip is still in flight —
      // the outcome must not depend on that race.
      let release!: (id: number) => void;
      (findExecutionThreadId as any).mockReturnValue(new Promise<number>((r) => { release = r; }));
      cancelImmediately();

      const p = runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error('HTTP 500: TM1UserException: Cancel'); },
      );
      await Promise.resolve();
      release(42);

      const { result, cancelled } = await p;
      expect(cancelled).toBe(true);
      expect(result).toBeUndefined();
      expect(cancelThread).toHaveBeenCalledWith({ serverUrl: 'http://s' }, 42);
    });
  });

  it('passes includeTransient through to the v11 thread lookup', async () => {
    (findExecutionThreadId as any).mockResolvedValue(9);
    cancelImmediately();

    const cfg = { serverUrl: 'http://s' } as any;
    await runCancellableProcess('t', '}VSCode_SaveDataAll', cfg, runningOp({}), { includeTransient: true });
    expect(findExecutionThreadId).toHaveBeenCalledWith('Processes', '}VSCode_SaveDataAll', cfg, { includeTransient: true });
    expect(cancelJob).not.toHaveBeenCalled();
  });

  describe('a cancel must never outlive the run it belongs to', () => {
    // The lookup takes up to ~15 s (expand + plain fallback + /ActiveSession).
    // If `op` resolved meanwhile, the run is over — and since the transient
    // needle matches ANY inline execution of our own session, firing the cancel
    // now would kill whatever helper started next (ASCII preview, SecurityRefresh).

    it('does not cancel when the op finished while the lookup was still running', async () => {
      let release!: (id: number) => void;
      (findExecutionThreadId as any).mockReturnValue(new Promise<number>((r) => { release = r; }));
      cancelImmediately();

      // op resolves IMMEDIATELY, long before the lookup answers.
      const p = runCancellableProcess('t', '}VSCode_SaveDataAll', { serverUrl: 'http://s' } as any,
        async () => ({ ok: true }), { includeTransient: true });
      await Promise.resolve();
      release(42);                       // lookup answers only now

      const { result, cancelled } = await p;
      expect(result).toEqual({ ok: true });
      expect(cancelled).toBe(false);
      expect(cancelThread).not.toHaveBeenCalled();
    });

    it('does not cancel a v12 job when the op already finished', async () => {
      let release!: (id: string) => void;
      (findExecutionJobId as any).mockReturnValue(new Promise<string>((r) => { release = r; }));
      cancelImmediately();

      const p = runCancellableProcess('t', '}VSCode_SaveDataAll', { serverUrl: 'http://s', version: 'v12' } as any,
        async () => ({}), { includeTransient: true });
      await Promise.resolve();
      release('job-0');

      expect((await p).cancelled).toBe(false);
      expect(cancelJob).not.toHaveBeenCalled();
    });
  });

  describe('a failed cancel CALL still leaves a cancelled run', () => {
    // `cancelThread` can time out (5 s) or answer non-2xx AFTER TM1 accepted the
    // cancel. The run is dead either way, so the ensuing `500 …: Cancel` is a
    // cancellation — reporting it as "Execution failed" would be a lie.

    it.each([
      ['11.8', 'HTTP 500: TM1UserException: Cancel'],
      ['v12', 'HTTP 500: Der Vorgang wurde abgebrochen'],
    ])('recognises the %s cancel rejection after the cancel call failed', async (_v, message) => {
      (findExecutionThreadId as any).mockResolvedValue(42);
      (cancelThread as any).mockRejectedValueOnce(new Error('socket hang up'));
      cancelImmediately();

      const { result, cancelled } = await runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error(message); },
      );
      expect(cancelled).toBe(true);
      expect(result).toBeUndefined();
    });

    it('still propagates an UNRELATED failure after a failed cancel call', async () => {
      (findExecutionThreadId as any).mockResolvedValue(42);
      (cancelThread as any).mockRejectedValueOnce(new Error('socket hang up'));
      cancelImmediately();

      await expect(runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error('HTTP 500: division by zero'); },
      )).rejects.toThrow('division by zero');
    });

    it.each(['HTTP 500: TM1UserException: Cancel', 'HTTP 500: Der Vorgang wurde abgebrochen'])('recognizes external cancellation: %s', async message => {
      await expect(runCancellableProcess(
        't', 'MyProc', { serverUrl: 'http://s' } as any,
        async () => { throw new Error(message); },
      )).resolves.toEqual({ result: undefined, cancelled: true });
      expect(cancelThread).not.toHaveBeenCalled();
      expect(isCancelRejection(new Error('HTTP 500: TM1UserException: Cancel'))).toBe(true);
      expect(isCancelRejection(new Error('HTTP 500: boom'))).toBe(false);
      expect(isCancelRejection(undefined)).toBe(false);
    });
  });
});
