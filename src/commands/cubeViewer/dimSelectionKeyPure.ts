/**
 * Order- and duplicate-sensitive comparison of two element sequences, for
 * the Dimension Browser no-op detection (`messaging.ts#openDimBrowser`).
 *
 * A pure reordering of the same set is NO LONGER a no-op, since the visible
 * row order carries the axis order under the single-pane model. Under the
 * same model, an element may also occur more than once — hence an
 * element-by-element comparison instead of a set comparison (no
 * sort()/join()).
 */
export function sameElementSequence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) { return false; }
  return a.every((name, i) => name === b[i]);
}
