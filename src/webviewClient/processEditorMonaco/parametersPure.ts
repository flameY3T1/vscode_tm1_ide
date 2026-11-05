/** Pure helpers for parameters.ts — no dom dependencies. */

export { escapeAttr } from '../htmlUtils';

/**
 * Generate the next auto-name for an added parameter.
 *
 * Pattern: `pParam01`, `pParam02`, …, `pParam09`, `pParam10`, …
 * Always uses 2-digit zero-padded indices up through 9; ≥10 unpadded.
 *
 * @param existingCount  Current parameter count BEFORE the addition.
 *                       The new name uses `existingCount + 1`.
 */
export function nextAutoName(existingCount: number): string {
  const n = existingCount + 1;
  return 'pParam' + (n < 10 ? '0' : '') + n;
}

/**
 * Return a copy of `arr` with the entry at `from` relocated to `to`.
 *
 * Out-of-range, non-integer or identical indices yield an unchanged copy — the
 * up/down buttons rely on that, so the first row's ▲ and the last row's ▼ stay
 * harmless even if their `disabled` state is bypassed. The input array is never
 * mutated; entries move by reference (shallow copy).
 */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (!Number.isInteger(from) || !Number.isInteger(to)) { return out; }
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) { return out; }
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}
