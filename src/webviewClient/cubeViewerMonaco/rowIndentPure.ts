/**
 * Pure row-header indentation depth.
 *
 * The rule is the one an outline follows: a row is indented against the nearest
 * row ABOVE it that is one of its ancestors. No such row → flush. Indentation
 * may only state what the reader can check on screen, and "hangs under" is a
 * statement about the row above.
 *
 * Three rules were tried before, each one still staircasing rows that stand
 * side by side (all three found in click tests, 2026-08-07):
 *
 * - TM1 `Level` is the height above the deepest leaf, so siblings whose subtrees
 *   differ in depth carry different levels (leaf child = 0, consolidated child
 *   = 2). Indenting by `maxLevel - Level` pulls same-generation siblings apart.
 *   Still the fallback in `grid.ts` when no parent maps arrived at all.
 * - GENERATION (steps to the hierarchy root), normalized to the shallowest shown
 *   member, fixes those siblings but measures an INVISIBLE chain: a level-0
 *   filter puts only leaves on the axis, and leaves hanging at different depths
 *   got different indents although not one of their parents was on screen.
 * - COUNTING visible ancestors anywhere on the axis fixes that, but ignores
 *   ORDER: drag a child above its parent in the dimension browser and the grid
 *   still indented it under a parent that now sits below it.
 *
 * What survives from those rounds, and is pinned by tests: a gap in the chain is
 * skipped (expanding a node whose direct child carries no value drops that child
 * from the axis — the grandchild then indents against the grandparent instead of
 * jumping flush), and ancestry is searched through EVERY parent, since a member
 * under two consolidations may reach the visible one through its second parent.
 *
 * Real webview JS — single backslash in escapes.
 */

/**
 * All ancestors of `name`, walking up every parent. `allParents` carries the
 * full map when the host sent it; `parents` (first parent only) is the fallback.
 * Cycle-safe.
 */
export function collectAncestors(
  name: string,
  parents: Record<string, string>,
  allParents?: Record<string, string[]>,
): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>([name]);
  let frontier: string[] = [];

  const up = (n: string): string[] => {
    const all = allParents ? allParents[n] : undefined;
    if (all && all.length > 0) { return all; }
    const p = parents[n];
    return p === undefined ? [] : [p];
  };

  frontier = up(name);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const a of frontier) {
      if (seen.has(a)) { continue; }
      seen.add(a);
      out.add(a);
      for (const u of up(a)) { next.push(u); }
    }
    frontier = next;
  }
  return out;
}

/**
 * Per-row indent depth `depths[ri][di]`. `parentsPerDim[di]` is the first-parent
 * map (child → parent) of row dim `di`, `allParentsPerDim[di]` the full one when
 * available; every dim is measured on its own, against the members THAT dim puts
 * on the axis — otherwise a same-named member of another row dimension would
 * count as an ancestor.
 */
export function computeIndentDepths(
  tuples: string[][],
  parentsPerDim: Record<string, string>[],
  allParentsPerDim?: Record<string, string[]>[],
): number[][] {
  const nDims = parentsPerDim.length;
  if (tuples.length === 0 || nDims === 0) { return tuples.map(() => []); }

  const depths: number[][] = tuples.map(() => new Array<number>(nDims).fill(0));

  for (let di = 0; di < nDims; di++) {
    const parents = parentsPerDim[di] ?? {};
    const allParents = allParentsPerDim ? allParentsPerDim[di] : undefined;
    // Ancestor sets remembered per member: in wide views, thousands of rows
    // hang on the same few consolidations.
    const ancCache = new Map<string, Set<string>>();
    const ancestorsOf = (n: string): Set<string> => {
      let s = ancCache.get(n);
      if (s === undefined) { s = collectAncestors(n, parents, allParents); ancCache.set(n, s); }
      return s;
    };

    // Outline stack: on top is always the most recently seen row, under which
    // the following rows COULD hang. Everything that is not an ancestor of the
    // current row is cleared — so a row can never indent against something that
    // stands below it or lies in another branch.
    const stack: Array<{ name: string; depth: number }> = [];
    for (let ri = 0; ri < tuples.length; ri++) {
      const name = tuples[ri][di] ?? '';
      const anc = ancestorsOf(name);
      while (stack.length > 0 && !anc.has(stack[stack.length - 1].name)) { stack.pop(); }
      const d = stack.length > 0 ? stack[stack.length - 1].depth + 1 : 0;
      depths[ri][di] = d;
      stack.push({ name, depth: d });
    }
  }

  return depths;
}
