export {};

/**
 * The comparison with which the CLIENT decides whether an ancestor survives the
 * filters of the stack. It must match `TM1FILTERBYPATTERN`, otherwise the
 * display indents wrongly.
 *
 * The semantics are measured on 11.8 (spec block F), not assumed:
 * anchored full comparison, case-insensitive, `*` = any sequence, `?` =
 * exactly one character, everything else literal, an empty pattern matches nothing.
 *
 * WHY NOT the old `treeOps.ts#_compileWildcard` (removed 2026-10-04): it builds an UNANCHORED regex
 * (`new RegExp(p, 'i')` without `^`/`$`) and returns none at all without `*`/`?`.
 * Both are wrong here - `um*` would match `sum` with it, but TM1 does not.
 *
 * The damage of a deviation is limited: one indentation level off.
 * WHICH rows appear is still decided by the server alone.
 */

/** What must be known about a row or an ancestor. */
export interface FilterCandidate {
  name: string;
  type: 'N' | 'C' | 'S';
  level: number;
  /**
   * Attribute values - only filled if the request ordered them
   * (`chainFor` → `attr`). If they are missing, `matchesLayer` fails for the
   * attribute layer instead of silently letting it through: an indented
   * ancestor that the server filtered away is a lie about the tree.
   */
  attrs?: Record<string, string> | undefined;
}

export type FilterLayer =
  /**
   * `attr` is the DISPLAY alias, if one is switched on: the search
   * hits what is visible (decision flameY3T1, 2026-08-23).
   * `TM1FILTERBYPATTERN` takes it as the third argument and then searches ONLY
   * there - measured live, `"*_C"` matches 272 names, but 5 aliases.
   */
  | { kind: 'pattern'; pattern: string; attr?: string }
  | { kind: 'type'; types: ReadonlyArray<'N' | 'C' | 'S'> }
  /**
   * SEVERAL levels at once (decision flameY3T1, 2026-08-23). `TM1FILTERBYLEVEL`
   * takes only one - the expression unites them and afterwards restores the
   * tree order (see `viewMdx.ts`).
   */
  | { kind: 'level'; levels: number[] }
  /**
   * An attribute value CONTAINS the text. Deliberately a different meaning than
   * `pattern`: the server filter here is `INSTR(...) > 0` (substring), there
   * `TM1FILTERBYPATTERN` (anchored pattern).
   *
   * SEVERAL attributes, since the selection permits "none": then all are
   * searched and - via `withName` - the element name as well (decision flameY3T1,
   * 2026-08-23). A disjunction in ONE `FILTER`, no `UNION`: a filter
   * stays a predicate, a union would produce duplicates.
   */
  | { kind: 'attr'; attrs: string[]; value: string; withName?: boolean };

/** Everything that has a meaning in a regex - except `*` and `?`. */
const REGEX_SPECIAL_CHARS = /[.+^${}()|[\]\\]/g;

export function matchesPattern(name: string, pattern: string): boolean {
  // Measured: `""` matches NOTHING. Interpreting an empty pattern as "everything" would be
  // the convenient assumption and the wrong one.
  if (!pattern) { return false; }
  const literal = pattern.replace(REGEX_SPECIAL_CHARS, '\\$&');
  const rx = literal.replace(/\*/g, '.*').replace(/\?/g, '.');
  try {
    // `^`/`$`: anchored. Exactly the point where `_compileWildcard` deviates.
    return new RegExp(`^${rx}$`, 'i').test(name);
  } catch {
    // A pattern that does not yield a valid regex matches nothing - and says so
    // in the console, instead of silently letting everything through.
    console.warn(`[dimBrowser] pattern '${pattern}' is not a valid regex.`);
    return false;
  }
}

export function matchesLayer(cand: FilterCandidate, layer: FilterLayer): boolean {
  switch (layer.kind) {
    case 'pattern': {
      // Compare the same value as the server, otherwise the indentation follows
      // something other than the row selection.
      if (!layer.attr) { return matchesPattern(cand.name, layer.pattern); }
      const value = cand.attrs ? cand.attrs[layer.attr] : undefined;
      // No value, no hit - like the attribute filter next to it.
      return value ? matchesPattern(value, layer.pattern) : false;
    }
    case 'type': return layer.types.indexOf(cand.type) >= 0;
    case 'level': return layer.levels.indexOf(cand.level) >= 0;
    case 'attr': {
      if (!layer.value) { return false; }
      const needle = layer.value.toUpperCase();
      const hits = (w: string | undefined): boolean =>
        !!w && w.toUpperCase().indexOf(needle) >= 0;
      // No value, no hit - congruent with the server: live 11.8
      // returns an empty string for `Properties(attr)` when the alias value equals the
      // element name, and `INSTR("", x) > 0` is false.
      if (layer.withName && hits(cand.name)) { return true; }
      for (const a of layer.attrs) {
        if (hits(cand.attrs ? cand.attrs[a] : undefined)) { return true; }
      }
      return false;
    }
    default: {
      const unreachable: never = layer;
      throw new Error(`unbekannte Filterschicht: ${JSON.stringify(unreachable)}`);
    }
  }
}
