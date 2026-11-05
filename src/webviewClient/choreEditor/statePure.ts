/**
 * Pure state helpers for the Chore Editor webview client.
 *
 * Everything here is DOM-free and vscode-free so it can be unit-tested without a
 * renderer (`src/test/webviewClient/choreEditorStatePure.test.ts`). `index.ts`
 * keeps only the DOM plumbing and delegates the decisions to these functions.
 */

export interface ClientParam {
  name: string;
  /** 'Numeric' | 'String'; '' means "unknown" (chore payload carried no type). */
  type: string;
  value: string;
}

export interface ClientTask {
  processName: string;
  params: ClientParam[];
}

/** One rendered parameter input, read back off the DOM before saving. */
export interface ParamInput {
  taskIdx: number;
  name: string;
  /** The row's `data-type` — comes from the PROCESS definition, so authoritative. */
  type: string;
  value: string;
}

/**
 * Process parameter definitions, keyed by lower-cased process name.
 *
 * The four states are distinct on purpose:
 *   - `undefined` — never requested;
 *   - `'loading'` — request in flight;
 *   - `'error'`   — the request FAILED. NOT the same as "this process has no
 *     parameters": caching a failed fetch as `[]` made the editor report
 *     "ready", drop every type to unknown and send a numeric as a string;
 *   - `ClientParam[]` — the authoritative definition (`[]` = the process really
 *     has no parameters).
 */
export type ParamsCache = Record<string, ClientParam[] | 'loading' | 'error' | undefined>;

/** A numeric parameter holding something that is not a number. */
export interface InvalidNumericParam {
  taskIdx: number;
  name: string;
  value: string;
}

/**
 * Parameters the process defines as Numeric but which hold a non-numeric value.
 *
 * An EMPTY value is not an offender: it deliberately falls back to the process
 * default on save (`coerceChoreParamValue`). Anything actually typed must be
 * caught here, because that same fallback would otherwise swallow it — entering
 * `ljhljhlj` saved without complaint and silently wrote the default instead.
 */
export function findInvalidNumericParams(tasks: ClientTask[]): InvalidNumericParam[] {
  const out: InvalidNumericParam[] = [];
  tasks.forEach((task, taskIdx) => {
    for (const p of task.params ?? []) {
      if (p.type !== 'Numeric') { continue; }
      const raw = String(p.value ?? '').trim();
      if (raw === '' || Number.isFinite(Number(raw))) { continue; }
      out.push({ taskIdx, name: p.name, value: raw });
    }
  });
  return out;
}

/**
 * Merge the rendered parameter inputs back into the task state.
 *
 * The rendered row's `data-type` wins ALWAYS — not just for parameters that are
 * new to the task. It is derived from the process's own parameter definition,
 * whereas the type carried by the chore payload is frequently missing or wrong
 * (TM1 does not report a task parameter's type). Keeping the stale type is what
 * made "open a chore and save it unchanged" send a numeric parameter as a JSON
 * string, which TM1 rejects with a param-mismatch error.
 */
export function mergeParamInputs(tasks: ClientTask[], inputs: ParamInput[]): void {
  for (const inp of inputs) {
    const task = tasks[inp.taskIdx];
    if (!task) { continue; }
    // Case-INsensitive, like every other parameter lookup here (the rendered
    // row, `buildSaveTasks`, `repairParamTypes`). An exact match used to push a
    // SECOND entry whenever the chore stored `PYEAR` and the process defines
    // `pYear` — both then went out and TM1 answered the param-count mismatch
    // with a 400, after the tasks had already been deleted.
    const existing = task.params.find(p => p.name.toLowerCase() === inp.name.toLowerCase());
    if (existing) {
      // `inp.name` carries the PROCESS definition's casing, so adopt it — that
      // is the spelling TM1 expects in the payload.
      existing.name = inp.name;
      existing.value = inp.value;
      if (inp.type) { existing.type = inp.type; }
    } else {
      task.params.push({ name: inp.name, type: inp.type || 'String', value: inp.value });
    }
  }
}

/**
 * Apply a single edited parameter input to the task state (same type rule as
 * `mergeParamInputs`, for one field).
 */
export function applyParamInput(tasks: ClientTask[], input: ParamInput): void {
  mergeParamInputs(tasks, [input]);
}

/**
 * Process names whose parameter definitions have not arrived yet. Saving while
 * any of them is outstanding would send parameters that never got the type
 * correction from the rendered rows.
 */
export function pendingParamProcesses(tasks: ClientTask[], cache: ParamsCache): string[] {
  const out: string[] = [];
  for (const t of tasks) {
    if (!t.processName) { continue; }
    const cached = cache[t.processName.toLowerCase()];
    if (cached === undefined || cached === 'loading') {
      if (out.indexOf(t.processName) < 0) { out.push(t.processName); }
    }
  }
  return out;
}

/**
 * Process names whose parameter definitions could not be FETCHED.
 *
 * Kept apart from `pendingParamProcesses` because the answer differs: pending
 * resolves on its own, a failed fetch does not. Saving with one outstanding is
 * what turned a numeric parameter into a string and dropped the process's own
 * defaults — the save is refused instead, and the entry stays retryable.
 */
export function failedParamProcesses(tasks: ClientTask[], cache: ParamsCache): string[] {
  const out: string[] = [];
  for (const t of tasks) {
    if (!t.processName) { continue; }
    if (cache[t.processName.toLowerCase()] === 'error') {
      if (out.indexOf(t.processName) < 0) { out.push(t.processName); }
    }
  }
  return out;
}

export interface SaveParam {
  Name: string;
  Value: string;
  Type: string;
  Default?: string;
}

export interface SaveTask {
  Step: number;
  processName: string;
  Parameters: SaveParam[];
}

/**
 * Build the `Tasks` array of the save payload.
 *
 * The process definition (`cache`) is authoritative for the whole parameter
 * LIST, not just for each entry's type and default. TM1 matches a chore task's
 * parameters against the process's own signature and rejects any count
 * mismatch — and that rejection lands after the existing tasks were already
 * deleted, so it costs a rollback.
 *
 * Driving the list from the definition therefore:
 *   - sends every parameter the process defines, filling one the chore does not
 *     carry with the process default (exactly what the rendered row shows);
 *   - DROPS a parameter the chore still carries but the process no longer
 *     defines. Such a leftover was never rendered (only `knownParams` are) and
 *     never validated by `findInvalidNumericParams` (its type stayed ''), yet
 *     used to be sent — a guaranteed 400 with no way for the user to see why;
 *   - takes name spelling, type and default from the definition.
 *
 * Only when the definition is NOT available (`undefined`/`'loading'`/`'error'`)
 * does it fall back to the chore's own parameters — the caller refuses to save
 * in that state (`pendingParamProcesses` / `failedParamProcesses`), so this is
 * the "cannot do better" branch, not the normal path.
 */
export function buildSaveTasks(tasks: ClientTask[], cache: ParamsCache): SaveTask[] {
  return tasks.map((t, i) => {
    const defs = cache[t.processName.toLowerCase()];
    const known = Array.isArray(defs) ? defs : null;
    const source: Array<{ name: string; type: string; def?: string }> = known
      ? known.map(d => ({ name: d.name, type: d.type, def: d.value }))
      : t.params.map(p => ({ name: p.name, type: p.type }));
    return {
      Step: i,
      processName: t.processName,
      Parameters: source.map(s => {
        const stored = t.params.find(p => p.name.toLowerCase() === s.name.toLowerCase());
        return {
          Name: s.name,
          Value: stored ? stored.value : (s.def ?? ''),
          Type: s.type,
          Default: s.def,
        };
      }),
    };
  });
}

// ── Frequency ─────────────────────────────────────────────────────────────

export const DEFAULT_FREQ = 'P1DT00H00M00S';

/** The frequencies the `<select>` offers as fixed options. */
export const KNOWN_FREQS = [
  'P0DT00H15M00S', 'P0DT00H30M00S', 'P0DT01H00M00S',
  'P0DT02H00M00S', 'P0DT04H00M00S', 'P0DT06H00M00S',
  'P0DT12H00M00S', 'P1DT00H00M00S', 'P7DT00H00M00S',
];

export interface FrequencyState {
  /** `<select>` value: a KNOWN_FREQS entry or the literal 'days'. */
  preset: string;
  /** `<input>` value for the n-days variant. */
  days: string;
  /**
   * Verbatim server value when the UI cannot represent it (e.g. `P0DT00H05M00S`
   * = every 5 minutes, or `P0DT03H00M00S` = every 3 hours). Kept so a
   * load→save round-trip does not silently collapse the schedule to "daily";
   * cleared as soon as the user actively picks a preset.
   */
  raw: string | null;
}

/** Map a TM1 frequency string onto the editor's controls. */
export function parseFrequency(freq: string | null | undefined): FrequencyState {
  if (!freq) { return { preset: DEFAULT_FREQ, days: '1', raw: null }; }
  if (KNOWN_FREQS.indexOf(freq) >= 0) { return { preset: freq, days: '1', raw: null }; }
  // Only a whole-day period is representable by the n-days input; anything with
  // a non-zero hour/minute/second part (or 0 days) has to be preserved verbatim.
  const m = /^P(\d+)DT00H00M00S$/.exec(freq);
  if (m && parseInt(m[1], 10) >= 1) { return { preset: 'days', days: m[1], raw: null }; }
  return { preset: DEFAULT_FREQ, days: '1', raw: freq };
}

/** Render the editor's controls back into a TM1 frequency string. */
export function formatFrequency(state: FrequencyState): string {
  if (state.raw) { return state.raw; }
  if (state.preset === 'days') {
    let days = parseInt(state.days || '1', 10);
    if (isNaN(days) || days < 1) { days = 1; }
    return 'P' + days + 'DT00H00M00S';
  }
  return state.preset || DEFAULT_FREQ;
}
