/** Pure helpers for chore editor — no vscode dependencies. */

import type { ChoreDetail, ChoreTask, ChoreParam } from '../../webviewClient/choreEditor/protocol';
import { encodeODataKey } from '../../utils/odataKey';

/**
 * Coerce a chore task parameter to the value TM1 accepts in the REST payload:
 * a JSON number for a Numeric parameter, or the raw string for a String
 * parameter (empty "" is valid). TM1 rejects a string/"" for a numeric with a
 * param-mismatch error, so a numeric MUST become a number:
 *   - a valid entry (incl. 0, negatives, decimals) is sent as parsed;
 *   - an empty or non-numeric field falls back to the process default if it has
 *     one (mirrors TM1 substituting the default for an omitted numeric param),
 *     else to 0 — TM1's own value for an empty numeric (verified live on 11.8:
 *     `Value:0` is accepted and round-trips as 0).
 */
export function coerceChoreParamValue(p: ChoreParam): number | string {
  if (p.Type !== 'Numeric') { return p.Value ?? ''; }
  const raw = String(p.Value ?? '').trim();
  if (raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) { return n; }
  }
  // Empty / invalid numeric → process default (only when it is itself numeric;
  // guard the empty-string default, since Number('') === 0 would mask it), else 0.
  const rawDef = String(p.Default ?? '').trim();
  const def = Number(rawDef);
  return rawDef !== '' && Number.isFinite(def) ? def : 0;
}

/**
 * Normalize a chore task parameter's type.
 *
 * TM1 does NOT reliably report `Type` on a chore task parameter — depending on
 * the server version and on which `$select`/`$expand` variant survived, the
 * field is simply absent. Guessing 'String' in that case is what silently turned
 * every numeric parameter into a string and made "open a chore and save it
 * unchanged" fail with a param-mismatch error, after the tasks had already been
 * deleted. So:
 *   - an explicit type (1/'Numeric', 2/'String') is honoured;
 *   - a JSON *number* value proves the parameter is numeric;
 *   - anything else returns '' = UNKNOWN, and the caller resolves it from the
 *     process's own parameter definition (webview: `data-type` on the rendered
 *     row; extension: `repairParamTypes` in `choreSavePure.ts`).
 */
export function normalizeChoreParamType(rawType: unknown, rawValue: unknown): string {
  if (rawType === 1 || rawType === 'Numeric') { return 'Numeric'; }
  if (rawType === 2 || rawType === 'String') { return 'String'; }
  if (typeof rawValue === 'number') { return 'Numeric'; }
  return '';
}

/**
 * Normalize a chore's `ExecutionMode`.
 *
 * Returns `undefined` = UNKNOWN whenever the server did not report a value we
 * recognize. That case is real, not defensive: the chore-detail fallback ladder
 * in `choreApi.ts` drops `ExecutionMode` from the root `$select` on servers that
 * reject it, and TM1 11.8 then answers with NO `ExecutionMode` key — verified
 * live against a chore whose actual mode is `SingleCommit`. Mapping that absence
 * to 'MultipleCommit' (the old behaviour) meant the very next save rewrote the
 * chore's transaction semantics without a word, and the rollback payload
 * downgraded it too. Callers must treat `undefined` as "do not write this
 * field", not as "the default".
 */
export function normalizeChoreExecutionMode(raw: unknown): 'SingleCommit' | 'MultipleCommit' | undefined {
  if (raw === 'SingleCommit') { return 'SingleCommit'; }
  if (raw === 'MultipleCommit') { return 'MultipleCommit'; }
  return undefined;
}

/**
 * Map raw TM1 chore-detail API response to typed ChoreDetail.
 *
 * Normalizes Tasks (with Parameters), coerces booleans, accepts `null`
 * as default for `StartTime`/`Frequency`.
 *
 * Pure — accepts any payload shape, applies defaults defensively. The one field
 * that gets NO default is `ExecutionMode` (see `normalizeChoreExecutionMode`).
 */
export function mapChoreDetailFromApi(c: {
  Name: string;
  Active?: unknown;
  DSTSensitive?: unknown;
  ExecutionMode?: unknown;
  StartTime?: string | null;
  Frequency?: string | null;
  Tasks?: unknown[];
}): ChoreDetail {
  const tasks: ChoreTask[] = ((c.Tasks ?? []) as Array<Record<string, unknown>>).map((t, idx) => ({
    Step: typeof t.Step === 'number' ? t.Step : idx,
    processName: ((t.Process as { Name?: string })?.Name ?? '') as string,
    Parameters: ((t.Parameters ?? []) as Array<Record<string, unknown>>).map(p => ({
      Name: p.Name as string,
      Type: normalizeChoreParamType(p.Type, p.Value),
      Value: p.Value != null ? String(p.Value) : '',
    })),
  }));
  return {
    Name: c.Name,
    Active: !!c.Active,
    DST: !!c.DSTSensitive,
    ExecutionMode: normalizeChoreExecutionMode(c.ExecutionMode),
    StartTime: c.StartTime ?? null,
    Frequency: c.Frequency ?? null,
    Tasks: tasks,
  };
}

/**
 * Build REST PATCH/POST payload from typed ChoreDetail.
 *
 * Tasks get sequential Step indices and the OData `Process@odata.bind`
 * reference. Defaults applied: StartTime → epoch-ish, Frequency → P1DT0...
 *
 * `ExecutionMode` is the deliberate exception: an UNKNOWN mode (the server never
 * reported one, see `normalizeChoreExecutionMode`) is OMITTED from the payload
 * instead of being guessed. PATCH only writes the fields it is given, so leaving
 * the key out keeps the chore's transaction semantics exactly as they are —
 * whereas sending 'MultipleCommit' would silently downgrade a SingleCommit
 * chore, on save AND on the rollback that is supposed to restore it.
 *
 * Pure.
 */
export function buildChorePayload(choreData: ChoreDetail): Record<string, unknown> {
  return {
    Name: choreData.Name,
    Active: choreData.Active,
    DSTSensitive: choreData.DST,
    ...(choreData.ExecutionMode ? { ExecutionMode: choreData.ExecutionMode } : {}),
    StartTime: choreData.StartTime ?? '2024-01-01T00:00:00Z',
    Frequency: choreData.Frequency ?? 'P1DT00H00M00S',
    Tasks: choreData.Tasks.map((t, idx) => ({
      Step: idx,
      'Process@odata.bind': `Processes('${encodeODataKey(t.processName)}')`,
      // TM1 requires EVERY process parameter to be present (count must match)
      // and a NUMERIC parameter's Value must be a JSON number — a string value,
      // including "" for an empty field, is rejected with a param-mismatch error
      // (verified live on 11.8). So: keep all params, coerce numerics to numbers,
      // and let an empty numeric fall back to the process default. An empty
      // STRING is fine ("" is accepted) so it passes through unchanged.
      Parameters: (t.Parameters ?? []).map(p => ({ Name: p.Name, Value: coerceChoreParamValue(p) })),
    })),
  };
}
