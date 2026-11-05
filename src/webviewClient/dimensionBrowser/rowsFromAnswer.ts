export {};

import { orderIsReplaced, type ViewState, type Intent } from './intents';
import { matchesLayer } from './filterPredicate';

/**
 * Field-identical copy of `tm1Rest/dimensionElementsApi.ts#AncestorRef` -
 * `webviewClient/` must not import from `tm1Rest/` (depcruise).
 */
export interface AncestorRef {
  name: string;
  type: 'N' | 'C' | 'S';
  level: number;
}

/**
 * A row as the server describes it. Field-identical copy of
 * `tm1Rest/dimensionElementsApi.ts#AnswerRow` - `webviewClient/` must not import
 * from `tm1Rest/` (depcruise layer rule).
 */
export interface AnswerRow {
  name: string;
  caption: string;
  type: 'N' | 'C' | 'S';
  level: number;
  parent: string | null;
  drilled: boolean;
  /**
   * The values of the ORDERED display columns. If the field is missing, nothing
   * was ordered; if a key is missing in it, the value is empty - TM1 omits
   * empty attribute values (measured live 11.8: 45 of 109 keys on 300
   * elements). Field-identical copy of
   * `tm1Rest/dimensionElementsApi.ts#AnswerRow.attrs`.
   */
  attrs?: Record<string, string>;
  /**
   * Element index - only filled if the column was ordered. `undefined` means
   * "not ordered", NOT "index 0".
   */
  index?: number;
  /**
   * Edge weight to the parent, PER OCCURRENCE - only if the column was ordered.
   * A root carries 0. Evidence in
   * `tm1Rest/dimensionElementsApi.ts#AnswerRow.weight`.
   */
  weight?: number;
  /**
   * The ancestors of this row, ROOT FIRST, without the row itself.
   *
   * Without them the indentation of a scrolled window cannot be derived: the
   * ancestors of the first window row lie above the window (finding of the
   * closing review of plan 1).
   *
   * OPEN ASSUMPTION: that `Parent.Parent` follows the same OCCURRENCE (and does
   * not, e.g. with multiple parenthood, jump to another occurrence of the same
   * element) is proven live for only ONE level - dimension `aa`, the same
   * element under `sum` and under `d` names the correct parent in each case. For
   * level 2 and deeper it is UNMEASURED; two attempts by the controller have not
   * answered it. No commitment until this has been made up.
   *
   * `type`/`level` per ancestor are only genuine if the request ordered `chain:
   * 'name+element'` - otherwise they are `'N'`/`0` (see
   * `tm1Rest/dimensionElementsApi.ts#buildSetExprQuery`).
   */
  ancestors: AncestorRef[];
  /**
   * ALL parents of this row - only filled if the answer is NOT in tree order
   * (`viewTrail#chainFor` orders them then).
   *
   * Over a foreign set `parent`/`ancestors` name the NATURAL way up, not the
   * visible one: measured live on `Cube A/Default` (11.8, 2026-08-23),
   * `Account 001` names `Group A` as its parent, while in the list `Total`
   * stands above it. Only with all parents can the question "does my parent
   * stand above me?" be answered.
   *
   * `undefined` means "not ordered", `[]` means "root".
   */
  parents?: string[];
}

/** A drawn row: the answer plus indentation and key. */
export interface DisplayRow extends AnswerRow {
  depth: number;
  /** Occurrence path + name. Identifies the row in the display. */
  key: string;
}

/**
 * Derive the indentation from the answer, guess nothing.
 *
 * The ancestor chain comes from the server (`AnswerRow.ancestors`) and is thus
 * complete even for a window in the middle of the dimension - the stack approach
 * of plan 1 started at zero and drew every scrolled page wrongly.
 *
 * The chain length ALONE is not the depth, though: over `TM1SUBSETALL` `a`
 * carries the parent `sum`, but stands BEFORE it and belongs in no block
 * (measured live 11.8). Whether the chain counts at all is NOT a property of
 * the base (`RowBase` used to exist here as a hand-copied union without a
 * compile binding to `./intents` - a fifth base value would silently have got the
 * indenting branch) - it is the question whether the concrete answer is in
 * HIERARCHY ORDER. As long as only `collapse` exists as an intent, base and
 * hierarchy order coincide (`tree`/`roots` -> yes, `set`/`explicit` -> no). If an
 * intent is added that sorts or filters (`TM1SORT`, `TM1FILTERBYPATTERN`,
 * `EXCEPT`, `UNION`, `TM1ROLLUP` - all in the action table of the design), that
 * falls apart: the answer then still carries ancestors, but in a window in which
 * they have been filtered out - the caller must know that and set `view`. The
 * caller knows its `ViewState` anyway; the row model does not need to know the
 * base values itself.
 *
 * Two things hang on the stack:
 *
 * 1. Is the order still that of the edge tree? Otherwise depth 0, period.
 * 2. Does an ANCESTOR survive the filters? Otherwise it does not count.
 *
 * Question 2 is the reason a `boolean` no longer suffices here - and it can be
 * answered without a server, because the chain brings type and level along
 * (task 2) and the predicate is ours (task 1).
 *
 * SKIP vs. BREAK:
 * - A FILTERED-OUT ancestor is SKIPPED - the chain continues.
 *   Reason: EXCEPT(Members, {xxx}, ALL) (likewise INTERSECT for `keep`) leaves
 *   the children of xxx in place - the rule holds for `filter`, `keep` AND
 *   `remove` alike (minor 8, closing review), not only `filter`.
 * - A COLLAPSED ancestor BREAKS the chain. Its children would not be in the
 *   answer at all (because collapsed = not drilled through).
 */
export function rowsFromAnswer(rows: readonly AnswerRow[], view: ViewState): DisplayRow[] {
  const out: DisplayRow[] = [];
  const flat = orderIsReplaced(view);
  const filterLayers = view.intents
    .filter((i): i is Extract<Intent, { kind: 'filter' }> => i.kind === 'filter')
    .map((i) => i.layer);
  // Set layers as predicates: `keep` lets only the named names through,
  // `remove` everything except them. Both are decidable per element without
  // asking the server - just like the filter layers.
  const setLayers = view.intents
    .filter((i): i is Extract<Intent, { kind: 'keep' | 'remove' }> =>
      i.kind === 'keep' || i.kind === 'remove')
    .map((i) => ({ kind: i.kind, names: new Set(i.names) }));

  /** Does this ancestor survive ALL layers of the stack? */
  const stays = (a: AncestorRef): boolean => {
    for (const l of filterLayers) {
      // Pass in the ancestor ITSELF, not a field copy: the earlier hand copy
      // `{name, type, level}` silently dropped `attrs`, and a new filter kind that
      // needs another field would then fall through silently - exactly the
      // fallback that the `never` traps otherwise prevent.
      if (!matchesLayer(a, l)) { return false; }
    }
    for (const m of setLayers) {
      const inside = m.names.has(a.name);
      if (m.kind === 'keep' ? !inside : inside) { return false; }
    }
    return true;
  };

  // NUL instead of a space as separator - as the old `rowIdentity.ts#rowKey` did
  // for a long time, and for the same reason: TM1 element names routinely
  // contain spaces (e.g. `Account 006`). With a space, parent `sum a` + child
  // `b` and parent `sum` + child `a b` collide to the same key - two rows, one
  // identity. Exactly the occurrence confusion that this rework abolishes.
  //
  // The marker below therefore also carries the FULL occurrence path, not just
  // the name: the same element can appear twice in the same window, once
  // expanded and once collapsed (multiple parenthood is the core case of this
  // rework). A name-based marker would then take the open occurrence for
  // collapsed too and aim indentation AND row identity at the wrong one
  // (review finding 2026-08-21; the same class of error as with the collapse
  // state: that too is kept per occurrence, not per name).
  //
  // `Set` instead of `Record<string, boolean>` (review finding I1/M1): an object
  // inherits from `Object.prototype` - an occurrence path that happens to be
  // called `constructor` or `toString` would read `collapsedInWindow[bis]` as truthy
  // without ever having been set.
  //
  // Invariant on which the depth derivation rests: an occurrence path appears
  // AT MOST ONCE per window, never once collapsed and once open. For a DFS
  // answer (`.Members`, `SUBSET`, `DRILLUPMEMBER`/`DRILLDOWNMEMBER` on such a
  // base) that is fulfilled. An expression that delivers the same occurrence
  // TWICE (`UNION(…, ALL)` keeps duplicates; measured live - `DRILLDOWNMEMBER`
  // returns the input itself as well) breaks the invariant: the second copy then
  // inherits the collapsed marker of the first, although it is an occurrence of
  // its own.
  /** Occurrence paths that appeared COLLAPSED in the window. */
  const collapsedInWindow = new Set<string>();
  /**
   * The open path - needed only for a FLAT base.
   *
   * `TM1SUBSETALL` carries every element exactly once, in index order; a
   * `DRILLDOWNMEMBER` pushes the children ADDITIONALLY behind the parent
   * (measured live 2026-08-22, dimSubsetallDrillDownProbe.js:
   * 8 rows become 9, `a` then appears twice - once at its index position, once
   * under `sum`). Both copies name the same parent chain. Only the one that
   * actually stands BEHIND its parent belongs indented, though.
   *
   * That is why the chain is not counted here but the path CARRIED ALONG: a row
   * is a child exactly if its parent is still open above it. The index copy at
   * the very top thus stays flat, the expanded one below it is indented.
   */
  const openPath: { name: string; depth: number; path: string }[] = [];
  for (const r of rows) {
    let depth = 0;
    let path = '';
    if (flat) {
      // The DEEPEST entry above the row that is one of its parents.
      //
      // `r.parents` (all parents) if ordered, otherwise the one named - over a
      // foreign set that one is the natural one and often is not in the list
      // at all (live `Cube A/Default`, 2026-08-23: `Account 001` names
      // `Group A`, above it stands `Total`).
      // Searched from the back, because with multiple parenthood the nearest
      // one counts - the row belongs in the block in which it stands.
      const parents = r.parents ?? (r.parent === null ? [] : [r.parent]);
      const i = parents.length === 0 ? -1
        : _lastIndex(openPath, (e) => parents.indexOf(e.name) >= 0);
      if (i >= 0) {
        openPath.length = i + 1;
        depth = openPath[i].depth + 1;
        path = openPath[i].path ? `${openPath[i].path}\x00${openPath[i].name}` : openPath[i].name;
      } else {
        openPath.length = 0;
      }
      openPath.push({ name: r.name, depth, path });
    }
    if (!flat) {
      for (const a of r.ancestors) {
        // SKIP if the ancestor does not survive the filters.
        // BREAK if it is collapsed.
        if (!stays(a)) { continue; }
        const bis = path ? `${path}\x00${a.name}` : a.name;
        if (collapsedInWindow.has(bis)) { break; }
        path = bis;
        depth++;
      }
    }
    // `path` carries only the ancestors that SURVIVED the filters
    // (see `stays`/SKIP above) - a filtered-out ancestor is missing from the
    // key on purpose, not by accident. Consequence: two rows whose only
    // distinguishing ancestor was filtered out fall on the same `key`.
    // Harmless today, because nobody selects by `key` yet; the next plan
    // (selection) has to look back here.
    const key = path ? `${path}\x00${r.name}` : r.name;
    out.push({ ...r, depth, key });
    // Note it only AFTER the row itself: a collapsed node still stands
    // there, only its block is missing.
    if (!r.drilled) { collapsedInWindow.add(key); }
  }
  return out;
}

/** The last index that satisfies the predicate - `-1` if none. */
function _lastIndex<T>(list: readonly T[], hit: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) { if (hit(list[i])) { return i; } }
  return -1;
}
