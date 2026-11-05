/**
 * Chore save orchestration — pure, no vscode. REST access is injected so the
 * whole sequence (including the failure/rollback path) is unit-testable.
 *
 * Why this is not a plain "PATCH the chore":
 *   - TM1 blocks task mutation on an ACTIVE chore (DELETE Tasks → HTTP 400
 *     "Can't duplicate active chore"), so the chore has to be deactivated first.
 *   - PATCH APPENDS tasks, it never replaces them, so the old tasks have to be
 *     deleted before the new ones are written.
 * That combination makes the sequence destructive BEFORE it is verified: if the
 * writing PATCH fails, the chore is left with zero tasks and inactive. Hence the
 * snapshot taken up front and the rollback below.
 */

import type { ChoreDetail, ChoreParam } from '../../webviewClient/choreEditor/protocol';
import { buildChorePayload } from './choreEditorPure';
import { errMsg } from '../../utils/errMsg';

/** A process parameter definition, used to repair missing chore-param types. */
export interface ProcessParamDef { name: string; type: string }

export interface ChoreSaveDeps {
  createChore(body: Record<string, unknown>): Promise<void>;
  updateChore(name: string, body: Record<string, unknown>): Promise<void>;
  clearChoreTasks(name: string): Promise<void>;
  /** Reads the chore back from the server, already mapped to `ChoreDetail`. */
  readChore(name: string): Promise<ChoreDetail>;
  /** Parameter definitions of a process — used to repair unknown param types. */
  readProcessParams?(processName: string): Promise<ProcessParamDef[]>;
  log?(message: string): void;
}

export interface ChoreSaveParams {
  isNew: boolean;
  originalName: string;
  choreData: ChoreDetail;
}

export interface ChoreSaveAsParams {
  /** The name the copy is created under — replaces the payload's own `Name`. */
  targetName: string;
  choreData: ChoreDetail;
}

export interface ChoreSaveAsOutcome {
  /** The copy is on the schedule (the source was active and activating it stuck). */
  activated: boolean;
  /** Set when the source was active but the copy could not be activated. */
  activateError?: string;
}

/**
 * What happened to the server-side state after a failed save:
 *   - `not-needed`    nothing destructive had run yet;
 *   - `restored`      the captured tasks + Active flag are back in place;
 *   - `failed`        the rollback itself errored — the chore may be EMPTY;
 *   - `not-possible`  the pre-save snapshot could not be read, so there was
 *                     nothing to restore from — the chore may be EMPTY.
 *
 * `not-possible` is unreachable from `saveChore`, which aborts before touching
 * anything when the snapshot fails. It stays in the union as the honest answer
 * for any future caller that does reach the destructive path without one.
 */
export type RollbackOutcome = 'not-needed' | 'restored' | 'failed' | 'not-possible';

export class ChoreSaveError extends Error {
  constructor(
    /** The original server error. */
    readonly detail: string,
    readonly rollback: RollbackOutcome,
    /** Why the rollback failed, when `rollback === 'failed'`. */
    readonly rollbackDetail?: string,
  ) {
    super(detail);
    this.name = 'ChoreSaveError';
  }
}

export interface ChoreSaveOutcome {
  sentTasks: number;
  /** Tasks the server reports after the save; `-1` when the read-back failed. */
  storedTasks: number;
  /** Set when the read-back could not be performed (the save itself succeeded). */
  readBackError?: string;
}

/** A param type we can act on. Anything else means "the server did not tell us". */
function isKnownType(t: string | undefined): boolean {
  return t === 'Numeric' || t === 'String';
}

/**
 * Fill in parameter types the server did not report, from the processes' own
 * parameter definitions. Without this a rollback would re-send a numeric
 * parameter as a JSON string and be rejected exactly like the save it undoes.
 */
export async function repairParamTypes(detail: ChoreDetail, deps: ChoreSaveDeps): Promise<ChoreDetail> {
  const needsRepair = detail.Tasks.some(t => t.Parameters.some(p => !isKnownType(p.Type)));
  if (!needsRepair || !deps.readProcessParams) { return detail; }

  const cache = new Map<string, Map<string, string>>();
  const Tasks = [];
  for (const task of detail.Tasks) {
    const key = task.processName.toLowerCase();
    if (key && !cache.has(key)) {
      try {
        const defs = await deps.readProcessParams(task.processName);
        cache.set(key, new Map(defs.map(d => [d.name.toLowerCase(), d.type])));
      } catch (err) {
        deps.log?.(`chore save: parameter types of process "${task.processName}" unavailable: ${errMsg(err)}`);
        cache.set(key, new Map());
      }
    }
    const defs = cache.get(key);
    const Parameters: ChoreParam[] = task.Parameters.map(p =>
      isKnownType(p.Type) ? p : { ...p, Type: defs?.get(p.Name.toLowerCase()) ?? p.Type },
    );
    Tasks.push({ ...task, Parameters });
  }
  return { ...detail, Tasks };
}

/**
 * Save a chore. For an existing chore the sequence is
 * deactivate → clear tasks → write → (re)activate, guarded by a snapshot taken
 * beforehand; any failure triggers a best-effort rollback to that snapshot.
 *
 * Throws `ChoreSaveError` (carrying the rollback outcome) on failure.
 */
export async function saveChore(deps: ChoreSaveDeps, params: ChoreSaveParams): Promise<ChoreSaveOutcome> {
  const body = buildChorePayload(params.choreData);
  const sentTasks = params.choreData.Tasks.length;

  if (params.isNew) {
    await deps.createChore(body);
    return { sentTasks, storedTasks: sentTasks };
  }

  const name = params.originalName;

  // Capture the server-side state BEFORE anything destructive runs. Parameter
  // types are repaired lazily in the rollback path — that costs one GET per
  // process and is only needed if we actually have to write the snapshot back.
  //
  // A failed snapshot ABORTS the save. The sequence below deletes every task
  // before it writes, so without a snapshot a rejected PATCH would leave the
  // chore empty with nothing to restore from — the exact data loss this whole
  // orchestration exists to prevent. Refusing to start is always recoverable
  // (the chore is untouched); starting blind is not.
  let snapshot: ChoreDetail;
  try {
    snapshot = await deps.readChore(name);
  } catch (err) {
    deps.log?.(`chore save: snapshot of "${name}" failed — save aborted, chore untouched: ${errMsg(err)}`);
    throw new ChoreSaveError(errMsg(err), 'not-needed');
  }

  try {
    await deps.updateChore(name, { Active: false });
  } catch (err) {
    // Nothing was destroyed yet — the chore is untouched.
    throw new ChoreSaveError(errMsg(err), 'not-needed');
  }

  try {
    await deps.clearChoreTasks(name);
    await deps.updateChore(name, { ...body, Active: false });
    if (params.choreData.Active) {
      await deps.updateChore(name, { Active: true });
    }
  } catch (err) {
    const rb = await rollbackChore(deps, name, snapshot);
    throw new ChoreSaveError(errMsg(err), rb.outcome, rb.detail);
  }

  // Read back: PATCH appends silently, and a partially accepted task list would
  // otherwise look like a clean save.
  try {
    const after = await deps.readChore(name);
    return { sentTasks, storedTasks: after.Tasks.length };
  } catch (err) {
    return { sentTasks, storedTasks: -1, readBackError: errMsg(err) };
  }
}

/**
 * "Save as" — write the edited chore to a NEW name. One POST, nothing
 * destructive, so none of the deactivate/clear/rollback dance above applies.
 *
 * The copy is always POSTed INACTIVE: `buildChorePayload` passes `Active`
 * through verbatim, so copying an active chore would put it on the server's
 * schedule the instant it is created — and the create path has no rollback to
 * undo that. Only once the copy exists is it activated, and a failure there is
 * REPORTED rather than thrown: the copy itself is fine, it just stays inactive.
 */
export async function saveChoreAs(deps: ChoreSaveDeps, params: ChoreSaveAsParams): Promise<ChoreSaveAsOutcome> {
  const body = { ...buildChorePayload(params.choreData), Name: params.targetName, Active: false };
  await deps.createChore(body);
  deps.log?.(`chore save-as: created "${params.targetName}" with ${params.choreData.Tasks.length} task(s), inactive.`);

  if (!params.choreData.Active) { return { activated: false }; }
  try {
    await deps.updateChore(params.targetName, { Active: true });
    return { activated: true };
  } catch (err) {
    deps.log?.(`chore save-as: "${params.targetName}" could not be activated: ${errMsg(err)}`);
    return { activated: false, activateError: errMsg(err) };
  }
}

/**
 * Best-effort restore of the captured state. Respects the same two TM1
 * constraints as the save path: tasks are only mutable while the chore is
 * INACTIVE, and PATCH appends — so the half-written list is cleared first.
 */
async function rollbackChore(
  deps: ChoreSaveDeps,
  name: string,
  snapshot: ChoreDetail | null,
): Promise<{ outcome: RollbackOutcome; detail?: string }> {
  if (!snapshot) { return { outcome: 'not-possible' }; }
  try {
    // TM1 usually omits a task parameter's type; without repairing it here the
    // restore would re-send a numeric as a string and be rejected in turn.
    const restore = await repairParamTypes(snapshot, deps);
    await deps.updateChore(name, { Active: false });
    await deps.clearChoreTasks(name);
    await deps.updateChore(name, { ...buildChorePayload(restore), Active: false });
    if (snapshot.Active) {
      await deps.updateChore(name, { Active: true });
    }
    deps.log?.(`chore save: rollback of "${name}" restored ${snapshot.Tasks.length} task(s).`);
    return { outcome: 'restored' };
  } catch (err) {
    deps.log?.(`chore save: rollback of "${name}" FAILED: ${errMsg(err)}`);
    return { outcome: 'failed', detail: errMsg(err) };
  }
}
