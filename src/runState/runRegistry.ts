import * as vscode from 'vscode';

/**
 * A single in-flight TM1 execution (process, chore, transient TI).
 *
 * The registry exists so a running execution can be shown INSIDE the TM1 IDE
 * (sidebar view + status bar) instead of a `ProgressLocation.Notification`
 * toast. The toast sits in the bottom-right corner for the whole run and covers
 * exactly the controls people need while a process runs — the dimension browser
 * and the element pickers of a view. Completion is still reported as a toast;
 * only the *running* state moved.
 */
export interface RunEntry {
  readonly id: string;
  /** Human-readable, already localized, e.g. `Running "load_sales"…`. */
  readonly label: string;
  /** Object name without decoration — used as the tree item label. */
  readonly objectName: string;
  readonly kind: 'Processes' | 'Chores';
  /** Server the run belongs to; shown when several servers are connected. */
  readonly serverUrl?: string;
  readonly startedAt: number;
  /** True once the user asked to cancel — the run is not gone yet. */
  cancelling: boolean;
  /** Best-effort server-side cancel. Never throws. */
  readonly cancel: () => void;
}

export interface RunStartInfo {
  label: string;
  objectName: string;
  kind: 'Processes' | 'Chores';
  serverUrl?: string;
  cancel: () => void;
}

const _runs = new Map<string, RunEntry>();
const _onDidChange = new vscode.EventEmitter<void>();

/** Fires whenever a run starts, is marked cancelling, or finishes. */
export const onDidChangeRuns: vscode.Event<void> = _onDidChange.event;

let _seq = 0;

/**
 * Register a run as in-flight. The caller MUST call `finishRun(id)` in a
 * `finally` — a leaked entry would leave a permanent "running" item in the
 * sidebar with no way to clear it.
 */
export function startRun(info: RunStartInfo): string {
  const id = `run#${++_seq}`;
  _runs.set(id, {
    id,
    label: info.label,
    objectName: info.objectName,
    kind: info.kind,
    serverUrl: info.serverUrl,
    startedAt: Date.now(),
    cancelling: false,
    cancel: info.cancel,
  });
  _onDidChange.fire();
  return id;
}

export function finishRun(id: string): void {
  if (_runs.delete(id)) { _onDidChange.fire(); }
}

/**
 * Give up on every run of one server. Returns how many entries were dropped.
 *
 * Called when a server is disconnected. The regular way out of a run is the
 * `finally { finishRun(id) }` in `runCancellableProcess` — but that only fires
 * once the pending `tm1.ExecuteWithReturn` settles, and that request runs with
 * `timeoutMs = 0` by design. After a disconnect the answer may never arrive,
 * so the entry — and with it the spinning status bar item — would stay forever.
 *
 * This drops the display only. The cancel hooks are deliberately NOT fired:
 * cancelling needs a live session to look the thread up, and the session is
 * being closed. The process keeps running on TM1; we merely stop claiming to
 * watch it. A late `finishRun` for the same id afterwards is a no-op.
 */
export function dropRunsForServer(serverUrl: string): number {
  if (!serverUrl) { return 0; }
  const doomed = [..._runs.values()].filter(r => r.serverUrl === serverUrl);
  for (const run of doomed) { _runs.delete(run.id); }
  if (doomed.length > 0) { _onDidChange.fire(); }
  return doomed.length;
}

/**
 * Give up on ONE run at the user's request. Returns whether an entry was there.
 *
 * The escape hatch for the case `dropRunsForServer` does not cover: the
 * connection dies WITHOUT the server being disconnected (Wi-Fi drop, machine
 * suspended). The pending `tm1.ExecuteWithReturn` then never settles, so the
 * `finally { finishRun(id) }` never runs — and the stop button does not help
 * either, since cancelling first has to look the thread up over the same dead
 * connection. Without this the entry, its spinner and the status bar item stay
 * for the rest of the session.
 *
 * Display only, exactly like `dropRunsForServer`: the cancel hook is NOT fired
 * and the process may well keep running on TM1. The caller has to say so.
 */
export function forgetRun(id: string): boolean {
  if (!_runs.delete(id)) { return false; }
  _onDidChange.fire();
  return true;
}

/** Insertion order — the sidebar lists runs in the order they started. */
export function listRuns(): RunEntry[] {
  return [..._runs.values()];
}

/**
 * Ask a run to stop. Marks it as cancelling (so the UI shows that the click
 * arrived) and fires the caller's cancel hook. The entry stays until the
 * execution itself resolves — killing the server-side thread is asynchronous
 * and may not even succeed.
 */
export function cancelRun(id: string): void {
  const run = _runs.get(id);
  if (!run || run.cancelling) { return; }
  run.cancelling = true;
  _onDidChange.fire();
  run.cancel();
}

/** Test seam — drops all entries without firing cancels. */
export function _clearRunsForTest(): void {
  _runs.clear();
  _seq = 0;
  _onDidChange.fire();
}
