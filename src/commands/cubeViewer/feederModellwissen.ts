import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getDimChildIndex } from './dimStructCache';
import { normName, type ModelKnowledge } from '../../debugUtility/feederTargetMatch';

/**
 * Builds the model knowledge for the feeder match: which dimension carries an
 * unqualified element name, and what hangs below a consolidation.
 *
 * Both are built ONCE per search run and then queried synchronously — the
 * match runs over all feeder statements times all hits, and a network call
 * per question would be the end of the sub-second times that make the whole
 * overfeeding run usable in the first place.
 *
 * `getDimChildIndex` keeps its index via a stamp comparison; a second run on
 * the same cube therefore costs nothing more.
 */
export async function loadModelKnowledge(
  dimensions: readonly string[], config: Tm1Config,
): Promise<ModelKnowledge> {
  /** Dimension per element. If a name collides in two dimensions, see below. */
  const dimOfElement = new Map<string, string | null>();
  /** Descendants per `dim|consolidation`, computed once. */
  const descendants = new Map<string, Set<string>>();

  for (const dim of dimensions) {
    let index;
    try {
      index = await getDimChildIndex(dim, config);
    } catch {
      // A dimension that cannot be read makes the match undecidable instead
      // of wrong: its elements stay unknown, and `hitsCell` reports
      // "unrecognized" for that instead.
      continue;
    }
    const all = new Set<string>();
    for (const [parent, children] of index.children) {
      all.add(parent);
      for (const k of children) { all.add(k); }
    }
    for (const el of all) {
      // The same element name in two dimensions cannot be resolved
      // unqualified. `null` explicitly records the ambiguity — otherwise the
      // most-recently-read dimension would win, and the match would be
      // silently wrong instead of visibly undecidable.
      const key = normName(el);
      dimOfElement.set(key,
        dimOfElement.has(key) && dimOfElement.get(key) !== dim ? null : dim);
    }
    for (const [parent] of index.children) {
      const set = new Set<string>();
      const stack = [...(index.children.get(parent) ?? [])];
      while (stack.length > 0) {
        const n = stack.pop() as string;
        if (set.has(n)) { continue; }
        set.add(n);
        for (const k of index.children.get(n) ?? []) { stack.push(k); }
      }
      descendants.set(`${normName(dim)}|${normName(parent)}`, new Set([...set].map(normName)));
    }
  }

  return {
    // Case-insensitive, because TM1 is too — a rule writes `'RULE'`, the
    // element is called `Rule`.
    dimensionOf: (element) => dimOfElement.get(normName(element)) ?? undefined,
    contains: (dimension, consolidation, element) =>
      descendants.get(`${normName(dimension)}|${normName(consolidation)}`)?.has(normName(element)) ?? false,
  };
}
