/**
 * Fixed caps for calls that deliberately ignore `tm1.timeoutMs`.
 *
 * The setting defaults to 0 (no timeout) because TM1 sends nothing until a
 * computation is done. These calls are side lookups where a late answer is
 * worth less than none — the caller has a fallback. Process execution and
 * rule saves never get a cap (pass `undefined` or 0 there).
 */

/** Completion lists, thread/job polls, connection probes: the UI waits on them. */
export const INTERACTIVE_CAP_MS = 5_000;
/** Small configuration reads and cleanup calls with an optimistic default. */
export const SIDE_READ_CAP_MS = 10_000;
/** View definitions, attribute lists, `$metadata`. */
export const METADATA_CAP_MS = 15_000;
/** Paged element/alias reads, element counts and the spread update. */
export const BULK_READ_CAP_MS = 30_000;
