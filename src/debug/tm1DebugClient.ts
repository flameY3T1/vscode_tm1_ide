import * as vscode from 'vscode';
import { apiRequest, assertOk } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { listThreads, cancelThread, type Tm1Thread } from '../tm1Rest/threadApi';
import { parseODataValueBody, parseJsonSafe } from '../tm1Rest/parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';
import { isOk } from '../tm1Rest/httpError';

export interface DebuggerState {
  id: string;
  status: string; // 'Paused' | 'Running' | 'Complete' | 'Aborted' | 'Ended'
  executeStatus?: string;
  errorLog?: string;
}

/**
 * Result of a `pollUntilPaused` round.
 *
 * `timedOut` is the load-bearing bit: the poll runs against a deadline, and when
 * that deadline elapses while the process is still `Running`, the returned
 * status is NOT a pause. Callers must branch on `timedOut` before rendering any
 * paused UI — treating a timeout as a pause is what pinned the editor on the
 * entry frame (Prolog) while TM1 had long moved on.
 */
export interface PollResult extends DebuggerState {
  /** true ⇒ the deadline elapsed while still running. Never a pause. */
  timedOut?: boolean;
  /** Last poll error when HTTP/network calls kept failing until the deadline.
   *  The poll loop logs and retries instead of dying on the first failure. */
  pollError?: string;
}

/** Consecutive poll rounds without a single server answer after which waiting gives up. */
export const MAX_UNREACHABLE_POLLS = 2;

/**
 * Polls until the process really pauses or ends. A poll timeout means "still
 * running", never a pause — long sections are legitimate (no hard timeout on
 * execute), so it keeps waiting and reports each timed-out round through
 * `onStillRunning`.
 *
 * Returns the last result as soon as `abandoned()` is true after a round, so
 * the caller decides what a cancelled wait means. Throws the last poll error
 * after `MAX_UNREACHABLE_POLLS` rounds in a row
 * without any answer: before, every caller polled until the window closed.
 * The one loop for the process editor, the DAP adapter and the coverage walk.
 */
export async function waitUntilSettled(
  client: { pollUntilPaused(id: string, processName?: string): Promise<PollResult> },
  id: string,
  processName: string,
  opts: { abandoned?: () => boolean; onStillRunning?: (pollError?: string) => void } = {},
): Promise<PollResult> {
  let unreachable = 0;
  for (;;) {
    const st = await client.pollUntilPaused(id, processName);
    if (!st.timedOut || opts.abandoned?.()) { return st; }
    unreachable = st.pollError ? unreachable + 1 : 0;
    if (unreachable >= MAX_UNREACHABLE_POLLS) { throw new Error(st.pollError ?? 'server not reachable'); }
    opts.onStillRunning?.(st.pollError);
  }
}

export interface StackFrame {
  id: string;
  /** TI section the frame executes in. `undefined` when the server did not
   *  report one — deliberately NOT defaulted to 'Prolog', which used to
   *  silently highlight the wrong section. */
  procedure?: string;
  /** `undefined` when the server did not report a line — no highlight then. */
  lineNumber?: number;
  /** Process this frame executes in — present when the server exposes the
   *  CallStack `Process` navigation (used to follow StepIn into sub-processes).
   *  undefined on TM1 versions that don't return it. */
  processName?: string;
}

export interface TiVariable {
  name: string;
  value: string;
}

// TM1 holds tm1.Debug POST open until the process pauses at the first line
// or completes. Use a generous timeout so the request does not abort early
// for long-running prologs.
const DEBUG_LONG_POLL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export class Tm1DebugClient {
  private readonly cfg: Tm1Config;
  private static _outputChannel: vscode.OutputChannel | undefined;

  constructor(cfg: Tm1Config) {
    this.cfg = cfg;
  }

  private static getOutputChannel(): vscode.OutputChannel {
    // Same name as in tm1DebugAdapter.ts — through the helper this is now
    // ONE channel instead of two identically named ones in the Output dropdown.
    if (!Tm1DebugClient._outputChannel) {
      Tm1DebugClient._outputChannel = outputChannel('TM1 Debug');
    }
    return Tm1DebugClient._outputChannel;
  }

  /** POST tm1.Debug — TM1 holds open until process pauses at first line. */
  async startDebug(processName: string, parameters: Array<{ Name: string; Value: string | number }> = []): Promise<DebuggerState> {
    const path = `Processes('${encodeODataKey(processName)}')/tm1.Debug`;
    const bodyStr = JSON.stringify({ Parameters: parameters });
    const res = await apiRequest('POST', path, bodyStr, DEBUG_LONG_POLL_TIMEOUT_MS, this.cfg);
    if (!isOk(res)) {
      throw new Error(`startDebug failed (${res.statusCode}): ${res.body}`);
    }
    interface DebugResponse {
      ID?: string; id?: string; Status?: string; status?: string;
      Result?: { ProcessExecuteStatusCode?: string; ErrorLogFile?: { Filename?: string } };
      ErrorLogFile?: { Filename?: string };
    }
    const data = parseJsonSafe<DebugResponse>(res.body, {});
    Tm1DebugClient.getOutputChannel().appendLine(`[startDebug] raw response: ${res.body.substring(0, 500)}`);
    const state = this.parseState(data);
    const logFilename = data.ErrorLogFile?.Filename ?? data.Result?.ErrorLogFile?.Filename;
    if (logFilename) {
      state.errorLog = await this.fetchErrorLog(logFilename).catch(() => undefined);
    } else if (this.isEnded(state.status) || state.executeStatus === 'Aborted' || state.executeStatus === 'CompletedWithMessages') {
      state.errorLog = await this.fetchLatestErrorLog(processName).catch(() => undefined);
    }
    return state;
  }

  async getStatus(id: string): Promise<DebuggerState> {
    const res = await apiRequest('GET', `ProcessDebugContexts('${encodeODataKey(id)}')`, undefined, undefined, this.cfg);
    if (res.statusCode === 404) { return { id, status: 'Ended' }; }
    assertOk(res, 'getStatus');
    return this.parseState(parseJsonSafe<Record<string, unknown>>(res.body, {}));
  }

  async getCallStack(id: string): Promise<StackFrame[]> {
    // Expand the `Process` navigation so we know which process each frame runs
    // in — needed to follow StepIn into a sub-process. Falls back to a plain
    // CallStack GET on servers that reject the expand (older TM1).
    const base = `ProcessDebugContexts('${encodeODataKey(id)}')/CallStack`;
    let res = await apiRequest('GET', `${base}?$expand=Process($select=Name)`, undefined, undefined, this.cfg);
    if (res.statusCode >= 400 && res.statusCode !== 404) {
      // Older TM1 rejects the expand. The plain GET carries no per-frame process
      // name, so StepIn routing degrades to "stay on the current panel" — log it
      // so that degraded mode is visible instead of looking like a routing bug.
      Tm1DebugClient.getOutputChannel().appendLine(
        `[getCallStack] $expand=Process rejected (${res.statusCode}) — falling back to plain CallStack; frames carry no process name`,
      );
      res = await apiRequest('GET', base, undefined, undefined, this.cfg);
    }
    if (res.statusCode === 404) { return []; }
    assertOk(res, 'getCallStack');
    interface CallStackRow {
      ID?: string | number; id?: string | number;
      Procedure?: string; procedure?: string;
      LineNumber?: number; Line?: number; lineNumber?: number;
      Process?: { Name?: string } | null;
      ProcessName?: string;
    }
    return parseODataValueBody<CallStackRow>(res).map((f) => {
      const frame: StackFrame = {
        id: String(f.ID ?? f.id ?? '1'),
        procedure: f.Procedure ?? f.procedure,
        lineNumber: f.LineNumber ?? f.Line ?? f.lineNumber,
        processName: f.Process?.Name ?? f.ProcessName ?? undefined,
      };
      if (frame.procedure === undefined || frame.lineNumber === undefined) {
        // Never invent 'Prolog'/line 1 here: the caller shows that as a real
        // stop position and the user chases a line the process is not on.
        Tm1DebugClient.getOutputChannel().appendLine(
          `[getCallStack] frame ${frame.id} without procedure/lineNumber (procedure=${String(frame.procedure)}, line=${String(frame.lineNumber)}) — reported as unknown, no highlight`,
        );
      }
      return frame;
    });
  }

  async getVariables(id: string, frameId: string): Promise<TiVariable[]> {
    const res = await apiRequest(
      'GET',
      `ProcessDebugContexts('${encodeODataKey(id)}')/CallStack('${encodeODataKey(frameId)}')/Variables`,
      undefined,
      undefined,
      this.cfg,
    );
    if (res.statusCode === 404) { return []; }
    assertOk(res, 'getVariables');
    interface VarRow { Name?: string; name?: string; Value?: string | number; value?: string | number }
    return parseODataValueBody<VarRow>(res).map((v) => ({
      name: v.Name ?? v.name ?? '',
      value: String(v.Value ?? v.value ?? ''),
    }));
  }

  async addBreakpoint(id: string, processName: string, procedure: string, lineNumber: number, bpId = 0): Promise<void> {
    const body = JSON.stringify({
      '@odata.type': 'tm1.ProcessDebugContextLineBreakpoint',
      ID: bpId,
      ProcessName: processName,
      Procedure: procedure,
      LineNumber: lineNumber,
    });
    const res = await apiRequest(
      'POST',
      `ProcessDebugContexts('${encodeODataKey(id)}')/Breakpoints`,
      body,
      undefined,
      this.cfg,
    );
    assertOk(res, 'addBreakpoint');
  }

  async removeBreakpoint(id: string, bpId: number): Promise<void> {
    const res = await apiRequest(
      'DELETE',
      `ProcessDebugContexts('${encodeODataKey(id)}')/Breakpoints('${encodeODataKey(String(bpId))}')`,
      undefined,
      undefined,
      this.cfg,
    );
    if (res.statusCode === 404) { return; }
    assertOk(res, 'removeBreakpoint');
  }

  async clearBreakpoints(id: string): Promise<void> {
    const res = await apiRequest(
      'GET',
      `ProcessDebugContexts('${encodeODataKey(id)}')/Breakpoints`,
      undefined,
      undefined,
      this.cfg,
    );
    if (res.statusCode !== 200) { return; }
    interface BpRow { ID?: number | string; id?: number | string }
    for (const bp of parseODataValueBody<BpRow>(res)) {
      const bpId = bp.ID ?? bp.id;
      if (bpId !== undefined) {
        await apiRequest(
          'DELETE',
          `ProcessDebugContexts('${encodeODataKey(id)}')/Breakpoints('${encodeODataKey(String(bpId))}')`,
          undefined,
          undefined,
          this.cfg,
        ).catch(() => {});
      }
    }
  }

  private async fetchErrorLog(filename: string): Promise<string | undefined> {
    const res = await apiRequest(
      'GET',
      `ErrorLogs('${encodeODataKey(filename)}')/tm1.GetContent`,
      undefined,
      undefined,
      this.cfg,
    );
    if (res.statusCode === 200) {
      const json = parseJsonSafe<{ Content?: string; value?: string }>(res.body, {});
      return json.Content ?? json.value ?? res.body;
    }
    return undefined;
  }

  private async fetchLatestErrorLog(processName?: string): Promise<string | undefined> {
    const res = await apiRequest(
      'GET',
      'MessageLogEntries?$orderby=TimeStamp desc&$top=10',
      undefined,
      undefined,
      this.cfg,
    );
    if (res.statusCode !== 200) { return undefined; }
    interface LogEntry {
      TimeStamp?: string; Timestamp?: string;
      Level?: string; Message?: string; Text?: string;
    }
    const entries = parseODataValueBody<LogEntry>(res);
    const match = processName
      ? entries.find((e) => (e.Message ?? e.Text ?? '').includes(processName))
      : entries[0];
    if (!match) { return undefined; }
    return `[${match.TimeStamp ?? match.Timestamp ?? ''}] ${match.Level ?? ''} ${match.Message ?? match.Text ?? JSON.stringify(match)}`;
  }

  async stepOver(id: string): Promise<void> { await this.action(id, 'tm1.StepOver'); }
  async stepIn(id: string): Promise<void> { await this.action(id, 'tm1.StepIn'); }
  async stepOut(id: string): Promise<void> { await this.action(id, 'tm1.StepOut'); }
  async continue(id: string): Promise<void> { await this.action(id, 'tm1.Continue'); }

  async stop(id: string, processName?: string): Promise<void> {
    if (processName) {
      // Cancel THIS context's thread only. Matching by process name hit every
      // run of it on the server: a second debug session, a colleague's run. The
      // context names its thread (`/Thread`, live 11.8 2026-11-03); the
      // Wait:DBG threads carry no Session, so the session cannot tell.
      const own = await apiRequest('GET', `ProcessDebugContexts('${encodeODataKey(id)}')/Thread?$select=ID`, undefined, undefined, this.cfg)
        .then(res => (isOk(res) ? parseJsonSafe<{ ID?: unknown } | null>(res.body, null)?.ID : undefined), () => undefined);
      if (typeof own === 'number') {
        await cancelThread(this.cfg, own).catch(() => {});
      } else {
        // shortcut: no `/Thread` (v12 unmeasured) — cancel only an unambiguous
        // single debug thread of this process, never a regular run; measure v12 to drop this.
        const threads = await listThreads(this.cfg).catch(() => [] as Tm1Thread[]);
        // TM1 reports the canonical spelling, the caller passes whatever the panel
        // key carries — match case-insensitively or the thread is never cancelled.
        const wanted = processName.toLowerCase();
        const debugging = threads.filter(t => String(t.ObjectName ?? '').toLowerCase() === wanted && t.State === 'Wait:DBG');
        if (debugging.length === 1) { await cancelThread(this.cfg, debugging[0].ID).catch(() => {}); }
      }
    }
    await apiRequest('DELETE', `ProcessDebugContexts('${encodeODataKey(id)}')`, undefined, undefined, this.cfg).catch(() => {});
  }

  isEnded(status: string): boolean {
    return status === 'Ended' || status === 'Aborted' || status === 'QuitCalled' || status === 'Complete';
  }

  /**
   * Polls the debug context until it leaves `Running` or the deadline elapses.
   *
   * Contract: the returned state is a genuine pause/end **only** when
   * `timedOut` is falsy. On deadline the result is `{ status: 'Running',
   * timedOut: true }` — long-running prologs are legitimate here, so callers are
   * expected to report "still running" and poll again rather than fake a pause.
   *
   * A failing poll request (HTTP/network) does not end the loop: it is logged
   * and retried until the deadline, then surfaced via `pollError`.
   */
  async pollUntilPaused(id: string, processName?: string, maxMs?: number): Promise<PollResult> {
    const timeout = maxMs ?? vscode.workspace.getConfiguration('tm1').get<number>('debugPollTimeoutMs') ?? 30000;
    const deadline = Date.now() + timeout;
    let lastError: string | undefined;
    while (Date.now() < deadline) {
      try {
        const s = await this.getStatus(id);
        lastError = undefined;
        if (s.status !== 'Running') {
          if (this.isEnded(s.status) && !s.errorLog) {
            s.errorLog = await this.fetchLatestErrorLog(processName).catch(() => undefined);
          }
          return s;
        }
      } catch (err) {
        // A single flaky GET must not kill the loop — that used to look like
        // "the debugger froze". Keep polling; report it if it never recovers.
        lastError = errMsg(err);
        Tm1DebugClient.getOutputChannel().appendLine(`[pollUntilPaused] status poll failed, retrying: ${lastError}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    return { id, status: 'Running', timedOut: true, pollError: lastError };
  }

  private async action(id: string, verb: string): Promise<void> {
    const res = await apiRequest(
      'POST',
      `ProcessDebugContexts('${encodeODataKey(id)}')/${verb}`,
      '{}',
      undefined,
      this.cfg,
    );
    if (res.statusCode === 404) { return; }
    assertOk(res, verb);
  }

  private parseState(data: any): DebuggerState {
    return {
      id: data.ID ?? data.id ?? '',
      status: data.Status ?? data.status ?? 'Unknown',
      executeStatus: data.Result?.ProcessExecuteStatusCode,
    };
  }
}
