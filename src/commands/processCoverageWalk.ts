/**
 * A coverage run over the TM1 debugger.
 *
 * Proven live on 2026-07-11 (TM1 11.8): `tm1.Debug` stops at the first line,
 * breakpoints can be set in the middle of the session, and a breakpoint that
 * is removed on the hit does not stop a loop a second time — the cost
 * depends on the number of distinct lines, not on the number of rounds.
 *
 * For counting, a breakpoint stays in place up to the cap; every round then
 * stops there. The cap is the price for that.
 */
import { errMsg } from '../utils/errMsg';
import { waitUntilSettled, type StackFrame, type DebuggerState, type PollResult } from '../debug/tm1DebugClient';
import {
  SECTIONS, breakpointId, lineKey, procedureName, sectionOf, type CoverageModel, type CoverageRun,
} from './processCoveragePure';

/** The slice of `Tm1DebugClient` the run needs. */
export interface CoverageDebugClient {
  startDebug(processName: string, parameters?: Array<{ Name: string; Value: string | number }>): Promise<DebuggerState>;
  addBreakpoint(id: string, processName: string, procedure: string, lineNumber: number, bpId?: number): Promise<void>;
  removeBreakpoint(id: string, bpId: number): Promise<void>;
  clearBreakpoints(id: string): Promise<void>;
  getCallStack(id: string): Promise<StackFrame[]>;
  continue(id: string): Promise<void>;
  pollUntilPaused(id: string, processName?: string, maxMs?: number): Promise<PollResult>;
  isEnded(status: string): boolean;
  stop(id: string, processName?: string): Promise<void>;
}

export interface WalkOptions {
  cap: number;
  isCancelled: () => boolean;
  onProgress?: (stops: number) => void;
}

/**
 * Runs the process in the debugger to the end and counts the stops per line.
 *
 * Cancelling does NOT mean killing the process: a write process that ran only
 * halfway would leave behind half-written data. Instead, all breakpoints are
 * removed, the process runs to completion undisturbed, and the run counts as
 * cancelled. The same applies to an error in the middle of the run.
 */
export async function walkCoverage(
  client: CoverageDebugClient,
  processName: string,
  params: Array<{ Name: string; Value: string | number }>,
  model: CoverageModel,
  opts: WalkOptions,
): Promise<CoverageRun> {
  const started = Date.now();
  const run: CoverageRun = {
    at: new Date(started).toISOString(), params, hits: {}, capped: [], cap: Math.max(1, opts.cap),
    status: '', durationMs: 0,
  };
  const state = await client.startDebug(processName, params);
  const id = state.id;
  let status = state.status;
  let executeStatus = state.executeStatus;
  if (!id) { run.status = status || 'Ended'; return run; }

  const release = async (): Promise<void> => {
    run.cancelled = true;
    await client.clearBreakpoints(id).catch(() => undefined);
    while (!client.isEnded(status)) {
      // 'Running' comes from a timeout: don't nudge it, just keep waiting.
      if (status !== 'Running') { await client.continue(id); }
      // Server gone: give up, otherwise the progress message and "Run" hang
      // until the window closes.
      const next = await waitUntilSettled(client, id, processName).catch(() => null);
      if (!next) { break; }
      status = next.status;
      executeStatus = next.executeStatus ?? executeStatus;
    }
  };

  try {
    let tried = 0;
    let accepted = 0;
    let firstRejection: unknown;
    for (const s of SECTIONS) {
      for (const line of model[s].lines) {
        // A line that TM1 rejects drops out of the run — it stays "never reached".
        tried++;
        try {
          await client.addBreakpoint(id, processName, procedureName(s), line, breakpointId(s, line));
          accepted++;
        } catch (err) { firstRejection ??= err; }
      }
    }
    // ALL rejected is not "0 % reached" — the run measured nothing. Report
    // it as a failure instead of a report that blames the process (review
    // 2026-10-03, A6).
    if (tried > 0 && accepted === 0) {
      throw new Error(`TM1 rejected all ${tried} breakpoints: ${errMsg(firstRejection)}`);
    }
    let stops = 0;
    while (!client.isEnded(status)) {
      if (opts.isCancelled()) { await release(); break; }
      const top = (await client.getCallStack(id))[0];
      const s = sectionOf(top?.procedure);
      // A child process (ExecuteProcess) does not stop — it has no breakpoints.
      if (s && top?.lineNumber !== undefined && (!top.processName || top.processName.toLowerCase() === processName.toLowerCase())) {
        const k = lineKey(s, top.lineNumber);
        const n = (run.hits[k] ?? 0) + 1;
        run.hits[k] = n;
        if (n >= run.cap) {
          if (run.cap > 1) { run.capped.push(k); }
          await client.removeBreakpoint(id, breakpointId(s, top.lineNumber)).catch(() => undefined);
        }
      }
      opts.onProgress?.(++stops);
      await client.continue(id);
      // An unreachable server throws: the catch below releases and stops.
      const next = await waitUntilSettled(client, id, processName, { abandoned: opts.isCancelled });
      status = next.status;
      executeStatus = next.executeStatus ?? executeStatus;
    }
  } catch (err) {
    await release().catch(() => undefined);
    throw err;
  } finally {
    // Only a process that is still stopped gets cancelled — otherwise a
    // `Wait:DBG` thread would sit there with its locks until the server restarts.
    await client.stop(id, client.isEnded(status) ? undefined : processName).catch(() => undefined);
    run.durationMs = Date.now() - started;
  }
  run.status = executeStatus || status;
  return run;
}
