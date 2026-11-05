/** Merges a follow-up delta per axis dimension into the existing map.
 *  New copy instead of in place: `state.lastMatrix` is read in several places,
 *  and a silently mutated map makes rendering errors impossible to track down.
 *
 *  SUPPLEMENT, do not replace: the page only brings the names of ITS rows.
 *  Whoever overwrites the map throws away the parent chains of the rows that
 *  are already loaded - those would then be indented flat and lose their
 *  collapse triangle. */
export function mergeParentDelta<T>(
  base: Record<string, T>[], delta?: Record<string, T>[],
): Record<string, T>[] {
  if (!delta) { return base; }
  const n = Math.max(base.length, delta.length);
  const out: Record<string, T>[] = [];
  for (let i = 0; i < n; i++) { out.push({ ...(base[i] ?? {}), ...(delta[i] ?? {}) }); }
  return out;
}
