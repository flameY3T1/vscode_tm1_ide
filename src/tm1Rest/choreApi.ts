import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseODataValueBody, parseBody } from './parseRest';
import { encodeODataKey } from '../utils/odataKey';
import { isOk } from './httpError';

/** Subset of chore fields commonly read from `/Chores?$select=...`. */
export interface Tm1Chore {
  Name: string;
  Active?: boolean;
  StartTime?: string | null;
  Frequency?: string | null;
  DST?: boolean;
  ExecutionMode?: string | null;
}

const DEFAULT_EXECUTE_TIMEOUT_MS = 60_000;

/**
 * GET /Chores — list chores with optional $select.
 * @param select OData $select clause (defaults to "Name,Active,StartTime,DST").
 */
export async function listChores(cfg: Tm1Config, select = 'Name,Active,StartTime,DST'): Promise<Tm1Chore[]> {
  const res = await apiRequest('GET', `Chores?$select=${select}`, undefined, undefined, cfg);
  assertOk(res);
  return parseODataValueBody<Tm1Chore>(res);
}

/**
 * `$select`/`$expand` variants for a single chore, richest first.
 *
 * Two TM1 quirks drive this ladder:
 *   - a chore task's `Parameters` is an OData COMPLEX type, so it must be pulled
 *     in through a nested `$select`; `$expand=Parameters` is HTTP 400 on strict
 *     servers (see docs/architecture/tm1-rest-quirks.md);
 *   - servers disagree about which nested `$select`/`$expand` form they accept
 *     at all — `referenceIndexService.ts#fetchAllChores` needs the same kind of
 *     ladder for the chore graph.
 * Falling back keeps the editor usable on a picky server; the only thing lost is
 * the parameter `Type`, which the caller then resolves from the process
 * definition instead.
 *
 * `ExecutionMode` is in every root `$select` we can get away with, because TM1
 * only reports it when it was selected. The last two variants drop it again for
 * servers that reject it — and TM1 11.8 then answers with NO `ExecutionMode` key
 * at all (live-verified against a chore whose real mode is `SingleCommit`).
 *
 * That absence is NOT "MultipleCommit". `mapChoreDetailFromApi` maps the missing
 * key to `undefined` = UNKNOWN and `buildChorePayload` then OMITS the field, so
 * a chore loaded through one of the last two variants keeps its transaction
 * semantics instead of being downgraded by the next save (and by the rollback).
 * Anything else reading this ladder's `data` must make the same distinction.
 */
export const CHORE_DETAIL_VARIANTS: ReadonlyArray<{ select: string; expand: string }> = [
  {
    select: 'Name,Active,DSTSensitive,ExecutionMode,StartTime,Frequency',
    expand: 'Tasks($select=Step,Parameters;$expand=Process($select=Name))',
  },
  {
    select: 'Name,Active,DSTSensitive,ExecutionMode,StartTime,Frequency',
    expand: 'Tasks($select=Step,Parameters;$expand=Process)',
  },
  {
    select: 'Name,Active,DSTSensitive,ExecutionMode,StartTime,Frequency',
    expand: 'Tasks($expand=Process($select=Name))',
  },
  {
    select: 'Name,Active,DSTSensitive,StartTime,Frequency',
    expand: 'Tasks($expand=Process($select=Name))',
  },
  {
    select: 'Name,Active,DSTSensitive,StartTime,Frequency',
    expand: 'Tasks($expand=Process)',
  },
];

export interface ChoreDetailFetch {
  /** Raw parsed body — callers map the fields they need. */
  data: Record<string, unknown>;
  /** The variant URL the server accepted (for logging/diagnostics). */
  url: string;
}

/**
 * GET /Chores('<name>') — fetch a single chore including its tasks, trying the
 * `CHORE_DETAIL_VARIANTS` ladder until one is accepted. Throws the LAST server
 * error when every variant is rejected.
 */
export async function getChoreDetail(cfg: Tm1Config, name: string): Promise<ChoreDetailFetch> {
  const enc = encodeODataKey(name);
  let last: { statusCode: number; body: string } | undefined;
  for (const v of CHORE_DETAIL_VARIANTS) {
    const url = `Chores('${enc}')?$select=${v.select}&$expand=${v.expand}`;
    const res = await apiRequest('GET', url, undefined, undefined, cfg);
    if (isOk(res)) {
      // Strict: the save snapshot and deploy write this back; `{}` would mean zero tasks.
      return { data: parseBody<Record<string, unknown>>(res), url };
    }
    last = res;
  }
  assertOk(last ?? { statusCode: 500, body: 'no chore-detail variant was attempted' });
  // Unreachable — assertOk always throws for the non-2xx we land here with.
  return { data: {}, url: '' };
}

/** POST /Chores('<name>')/tm1.Execute. Throws on non-2xx. */
export async function executeChore(
  cfg: Tm1Config,
  name: string,
  timeoutMs: number = DEFAULT_EXECUTE_TIMEOUT_MS,
): Promise<void> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('POST', `Chores('${enc}')/tm1.Execute`, '{}', timeoutMs, cfg);
  assertOk(res);
}

/** PATCH /Chores('<name>') with `{Active: <flag>}`. */
export async function setChoreActive(cfg: Tm1Config, name: string, active: boolean): Promise<void> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('PATCH', `Chores('${enc}')`, JSON.stringify({ Active: active }), undefined, cfg);
  assertOk(res);
}

/**
 * GET /Chores('<name>')?$select=Name — does a chore with that name exist?
 *
 * Deliberately does NOT throw on a non-2xx: a 404 is the expected "no" answer.
 * Only a transport failure propagates, so a caller can tell "name is free" from
 * "server unreachable".
 */
export async function choreExists(cfg: Tm1Config, name: string): Promise<boolean> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('GET', `Chores('${enc}')?$select=Name`, undefined, undefined, cfg);
  return res.statusCode === 200;
}

/** POST /Chores — create a chore. Body is the full payload. */
export async function createChore(cfg: Tm1Config, body: Record<string, any>): Promise<void> {
  const res = await apiRequest('POST', 'Chores', JSON.stringify(body), undefined, cfg);
  assertOk(res, 'Chore could not be created');
}

/** PATCH /Chores('<name>') with arbitrary payload. */
export async function updateChore(
  cfg: Tm1Config,
  name: string,
  body: Record<string, any>,
  errorMsg = 'Chore could not be saved',
): Promise<void> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('PATCH', `Chores('${enc}')`, JSON.stringify(body), undefined, cfg);
  assertOk(res, errorMsg);
}

/** DELETE /Chores('<name>'). */
export async function deleteChore(cfg: Tm1Config, name: string): Promise<void> {
  const enc = encodeODataKey(name);
  const res = await apiRequest('DELETE', `Chores('${enc}')`, undefined, undefined, cfg);
  assertOk(res, 'Chore could not be deleted');
}

/**
 * DELETE all chore tasks by repeatedly deleting step 0
 * (TM1 renumbers tasks after each delete).
 *
 * The delete loop alone CANNOT tell success from failure: it stops on the first
 * non-2xx, and "there is no task at step 0" is exactly how TM1 signals "the list
 * is empty now". A transient 500, or a 400 because the chore started executing
 * halfway through, looks identical. That matters because the caller's next step
 * is a PATCH, and PATCH APPENDS tasks — a half-cleared chore silently ends up
 * with duplicated tasks that run their processes twice.
 *
 * So the emptiness is VERIFIED by reading the task list back; anything left over
 * throws, which makes `saveChore` roll back instead of appending.
 */
export async function clearChoreTasks(cfg: Tm1Config, name: string, maxIterations = 200): Promise<void> {
  const enc = encodeODataKey(name);
  let lastError = '';
  let terminated = false;
  for (let i = 0; i < maxIterations; i++) {
    const res = await apiRequest('DELETE', `Chores('${enc}')/Tasks(0)`, undefined, undefined, cfg);
    if (!isOk(res)) {
      lastError = `HTTP ${res.statusCode}: ${(res.body ?? '').trim()}`;
      terminated = true;
      break;
    }
  }
  if (!terminated) {
    // `maxIterations` successful deletes without the server ever saying "no task
    // at step 0" — no real chore has that many tasks, so this is a bug (or a
    // server acknowledging deletes it does not perform), not a success.
    throw new Error(
      `Chore "${name}": ${maxIterations} task deletions did not empty the task list. `
      + 'Aborted to avoid appending onto a half-cleared chore.',
    );
  }

  let remaining: number;
  try {
    const res = await apiRequest('GET', `Chores('${enc}')/Tasks?$select=Step`, undefined, undefined, cfg);
    // A FAILING verification tells us nothing about the task list, and refusing
    // the save on it would break saving whenever this one read is flaky. So on
    // a non-2xx or a transport error: do not throw, return silently (this module
    // has no logger) and let the save proceed — the caller's post-save read-back
    // (`saveChore` → `ChoreSaveOutcome.storedTasks`) is the safety net there.
    if (!isOk(res)) { return; }
    remaining = parseODataValueBody<{ Step?: number }>(res).length;
  } catch {
    return;
  }

  if (remaining > 0) {
    throw new Error(
      `Chore "${name}": ${remaining} task(s) remained after clearing `
      + `(last server response: ${lastError}). `
      + 'Aborted to avoid appending onto a half-cleared chore.',
    );
  }
}
