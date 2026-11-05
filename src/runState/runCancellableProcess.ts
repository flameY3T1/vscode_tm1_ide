import type { Tm1Config } from '../tm1Rest/transport/types';
import { findExecutionThreadId, findExecutionJobId, cancelThread, cancelJob } from '../tm1Rest/threadApi';
import { errMsg } from '../utils/errMsg';
import { startRun, finishRun, cancelRun } from './runRegistry';

/** Structural twin of `vscode.CancellationToken` — keeps the vscode import out of this module. */
export interface CancelSignal {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/**
 * Runs `op` (a process or chore execution) as a cancellable entry in the TM1
 * IDE's "Running" sidebar view.
 *
 * IMPORTANT: aborting the HTTP request alone does NOT stop a long-running TM1
 * operation — the thread keeps executing on the server. Real cancellation means
 * killing the server-side thread. On user-cancel this looks up the running
 * thread (matched by the Function field, e.g. `Chores('X')/tm1.Execute`) and
 * issues `POST Threads(<id>)/tm1.CancelOperation`.
 *
 * `op` (the still-pending execute call) typically rejects/returns once the
 * thread is cancelled. Returns the op result plus whether cancellation was
 * issued locally or explicitly reported by TM1. The click alone proves nothing: the
 * lookup may find no thread (it returns undefined on every error too) and the
 * cancel call itself may fail. Without an issued cancel or a server cancellation
 * response, failures reach the caller instead of being reported as cancellation.
 */
export async function runCancellableExecution<T>(
  title: string,
  objectKind: 'Processes' | 'Chores',
  objectName: string,
  cfg: Tm1Config,
  op: () => Promise<T>,
  /** `includeTransient`: set when `op` may run its TI inline (no named object) —
   *  see `findExecutionThreadId`. `token`: a second stop button next to the
   *  "Running" view, e.g. a notebook cell's own Stop — it cancels the run the
   *  same way (server-side thread kill), not only the client wait. */
  opts?: { includeTransient?: boolean; token?: CancelSignal },
): Promise<{ result?: T; cancelled: boolean }> {
  let cancelIssued = false;
  /**
   * `op` RESOLVED — our run is over, so a cancel still in flight must not fire
   * any more. The lookup takes up to ~15 s (expand + plain fallback +
   * `/ActiveSession`), and the transient needle matches ANY inline execution of
   * our own session, so a helper started right after (ASCII datasource preview,
   * SecurityRefresh, CubeSaveData) would be killed by that stale cancel.
   * Only set on resolve: a REJECTION still needs the cancel's verdict below.
   */
  let finished = false;

  /** Never rejects — a failed lookup/cancel just leaves `cancelIssued` false. */
  const issueCancel = async (): Promise<void> => {
    try {
      if (finished) { return; }
      // TM1 does NOT serialize requests within a session, so the lookup/cancel
      // gets through while the execute is still running on the same session.
      if (cfg?.version === 'v12') {
        // v12 has no /Threads — running work is a Job (GUID key), cancelled
        // with tm1.Cancel. Live-verified: the pending execute then fails fast.
        const jobId = await findExecutionJobId(objectKind, objectName, cfg, opts);
        if (jobId === undefined || finished) { return; }
        try { await cancelJob(cfg, jobId); cancelIssued = true; } catch { /* best-effort — job may have finished */ }
        return;
      }
      const id = await findExecutionThreadId(objectKind, objectName, cfg, opts);
      if (id === undefined || finished) { return; }
      try { await cancelThread(cfg, id); cancelIssued = true; } catch { /* best-effort — thread may have finished */ }
    } catch { /* lookup blew up — no cancel was issued, that is all we need to know */ }
  };

  let cancelAttempt: Promise<void> | undefined;
  // The run shows up in the TM1 sidebar + status bar instead of a progress
  // notification: that toast sat on top of the dimension browser and the view
  // element pickers for the entire run — exactly when they are needed. The
  // completion toast stays where it was.
  const runId = startRun({
    label: title,
    objectName,
    kind: objectKind,
    serverUrl: cfg?.serverUrl,
    cancel: () => { cancelAttempt = issueCancel(); },
  });
  const tokenSub = opts?.token?.onCancellationRequested(() => cancelRun(runId));
  if (opts?.token?.isCancellationRequested) { cancelRun(runId); }
  try {
    // A killed run reports failure to the pending call — 11.8 answers
    // `500 TM1UserException: Cancel`, v12 `500 Der Vorgang wurde abgebrochen`.
    // That can also result from an external administrator's cancel, so swallow it and
    // let the caller show its "was cancelled" message instead of an error.
    const result = await op().then(
      (value) => { finished = true; return value; },
      async (err) => {
        // The op can reject while the lookup/cancel roundtrip is still in flight;
        // await it so the verdict never depends on that race.
        if (cancelAttempt) { await cancelAttempt; }
        if (cancelIssued) { return undefined; }
        // A failed cancel response or an external administrator's cancellation
        // can both leave a cancelled execution without a successful local call.
        if (isCancelRejection(err)) { cancelIssued = true; return undefined; }
        throw err;
      },
    );
    return { result, cancelled: cancelIssued };
  } finally {
    tokenSub?.dispose();
    finishRun(runId);
  }
}

/**
 * The two documented shapes TM1 reports a cancelled execution with: 11.8 answers
 * `500 TM1UserException: Cancel`, v12 `500 Der Vorgang wurde abgebrochen`.
 * Used for local and external cancellation; ordinary execution errors propagate.
 */
export function isCancelRejection(err: unknown): boolean {
  const msg = errMsg(err);
  return /TM1UserException:\s*Cancel\b/i.test(msg)
    || /(?:^|\bHTTP 500:\s*)Der Vorgang wurde abgebrochen[.!]?\s*$/i.test(msg);
}

/** Convenience wrapper for a process execution. */
export function runCancellableProcess<T>(
  title: string,
  processName: string,
  cfg: Tm1Config,
  op: () => Promise<T>,
  opts?: { includeTransient?: boolean; token?: CancelSignal },
): Promise<{ result?: T; cancelled: boolean }> {
  return runCancellableExecution(title, 'Processes', processName, cfg, op, opts);
}
