/**
 * Where "Save subset" takes its inputs from and where "Load subset" takes effect.
 *
 * A module of its own for the same reason as `mdxSource.ts`: `saveMode.ts` and
 * `msgSubset.ts` must not pull the whole drawing path into the old path, and the
 * switch belongs in ONE place so that saving and loading do not drift apart.
 */
import {
  currentRows, rowsComplete, currentAlias, currentMdx, setMdxBase, setNamesBase, setAlias,
  setBase, setLevel, resetView, postFromView, dimOfView, hierOfView,
} from './viewPath';

/** What a save needs - the same whichever path it comes from. */
export interface SubsetSaveInput {
  /** The visible elements, in their order. */
  names: string[];
  /** The display alias; empty means "under the element name". */
  alias: string;
  /** The set expression, or `null` if there is none. */
  expression: string | null;
  /**
   * Do `names` cover the WHOLE set?
   *
   * `false` means the server would have more than is loaded. A static save would
   * then be a silent truncation - the caller must reject that or fall back to the
   * expression, not simply write.
   */
  complete: boolean;
}

/**
 * The inputs for a save.
 *
 * In the new path taken from the view itself; otherwise what the caller brings
 * along (`state._visibleNames` and neighbours of the old path).
 */
export function subsetSaveInput(): SubsetSaveInput {
  return {
    names: currentRows().map((r) => r.name),
    alias: currentAlias(),
    expression: currentMdx(),
    complete: rowsComplete(),
  };
}

/** What of a `setSubsetElements` answer counts for the load path. */
export interface SubsetLoad {
  elements: string[];
  expression?: string | null;
  expressionUnread?: boolean;
  alias?: string | null;
}

/**
 * Load a subset into the view. Returns `true` if it was taken over - then the
 * old path must NOT draw as well.
 *
 * A DYNAMIC subset becomes the MDX base: its expression IS the answer.
 * A STATIC one becomes the names base, in the author's order.
 *
 * An UNREAD expression is neither of the two. `expression: null` used to mean
 * "static" AND "could not be read"; treating both the same silently turns a read
 * error into a static subset and writes the rule away on the next save. Here the
 * view stays unchanged, and the caller learns of it from the return value.
 */
export function loadSubsetIntoView(msg: SubsetLoad): boolean {
  if (msg.expressionUnread) { return false; }
  // The alias FIRST: it belongs to the base that is set right after, and set
  // later it triggered a second query of the same rows.
  setAlias((msg.alias ?? '').trim());
  const expr = (msg.expression ?? '').trim();
  if (expr) { setMdxBase(expr); } else { setNamesBase(msg.elements || []); }
  return true;
}

/**
 * May it be saved this way without losing anything?
 *
 * The name list describes only the LOADED window, the expression the whole set.
 * If not everything is loaded, a static save is therefore a silent truncation -
 * 1.6 million elements would become 5000, without a message.
 *
 * Kept apart from `subsetSaveInput` because it is an ANSWER to an intent
 * (dynamic or static) and not a property of the view.
 */
export function saveIsSafe(input: SubsetSaveInput, dynamic: boolean): boolean {
  if (input.complete) { return true; }
  return dynamic && !!input.expression;
}

/** What the save dialog needs to know about the MDX offer. */
export interface DynSavePlan {
  available: boolean;
  expression: string;
  reason: string;
}

/**
 * Detects whether an expression refers to the TARGET subset itself.
 *
 * Textual and deliberately generous: when TM1 writes a self-referencing
 * expression it deletes the members of the subset (live 11.8), and an empty
 * subset is more expensive than a refusal that can be worked around. Anyone who
 * wants more precise detection has to parse the expression - there is no reason
 * for that here.
 *
 * `baseIsTarget` (old `composeModel.ts`, removed 2026-10-04) was not suitable here: it checks a
 * STRUCTURED base reference, and at this point the new path carries only a
 * string.
 */
function refersToItself(mdx: string, target: { name: string }): boolean {
  const upper = mdx.toUpperCase();
  if (upper.indexOf('TM1SUBSETTOSET') < 0) { return false; }
  return upper.indexOf(`"${target.name.toUpperCase()}"`) >= 0;
}

/**
 * The MDX offer of the save dialog.
 *
 * In the new path there is ALWAYS an expression - it is in the bar and in the
 * popup. The old path instead derived the offer from drill context and
 * composition; the new one carries neither, which is why the checkbox was greyed
 * out and every save silently fell back to the flat list.
 */
export function dynamicSavePlanForView(
  target: { name: string; isPrivate: boolean },
): DynSavePlan {
  const mdx = currentMdx();
  if (!mdx) { return { available: false, expression: '', reason: 'no-base' }; }
  if (target.name && refersToItself(mdx, target)) {
    return { available: false, expression: '', reason: 'base-is-target' };
  }
  return { available: true, expression: mdx, reason: 'composed' };
}

/**
 * The four standard entries of the subset field in the new path.
 *
 * They are NOT subsets but views of the whole dimension - in the new path
 * therefore bases and layers. The old path expressed them via `state` fields
 * (`_subsetFilter`, `_rootsOnly`, `_levelFilter`) and a reload; the new one
 * carries neither, which is why the entries had no effect there.
 *
 * Returns `true` if the entry was handled here.
 */
export function applySubsetPseudoInView(choice: string): boolean {
  switch (choice) {
    // "All" is the withdrawal of every restriction, not a set of its own -
    // so the starting base with an empty stack.
    case '__all__': resetView(); return true;
    case '__toplevel__': setBase('roots'); return true;
    case '__nlevel__':
      // LEVEL 0, not element type N. Measured live (11.8, 621-element dimension):
      // `TM1FILTERBYLEVEL(all, 0)` returns 61, `ELEMENT_TYPE = "1"` only 60 -
      // the difference is exactly the string element. The old path once had the
      // quick filter "N only" here and thereby silently lost the S element.
      // Over TM1SUBSETALL, not `.Members`: every leaf once. Measured live (11.8,
      // 2026-11-04, 211,852 elements): `.Members` gave 831,097 rows for 27,310
      // leaves; TM1SUBSETALL costs ~850 ms per 10k window instead of ~500 ms.
      setBase('set');
      setLevel(0);
      return true;
    case '__default__': {
      // The server knows it, not we - the answer arrives as
      // `setDefaultMember` and runs into `applyDefaultMemberInView`.
      postFromView({ type: 'fetchDefaultMember', dimName: dimOfView(), hierName: hierOfView() });
      return true;
    }
    default: return false;
  }
}

/**
 * The answer to "Default member": a view of exactly that one element.
 *
 * An empty name changes NOTHING: the dimension then has none, and an empty base
 * would be an empty display without explanation.
 */
export function applyDefaultMemberInView(name: string | null): boolean {
  if (name) { setNamesBase([name]); }
  return true;
}
