// OData key escape for TM1 REST URL path segments such as Processes('<name>').
// TM1/OData requires doubling the apostrophe INSIDE the key literal,
// in addition to URL encoding — encodeURIComponent alone is not enough.

/** `'` → `''` (without URL encoding) — for call sites that encode themselves. */
export function escapeODataKey(s: string): string {
  return s.replace(/'/g, "''");
}

/** Complete: quote doubling + encodeURIComponent. Standard for URL paths. */
export function encodeODataKey(s: string): string {
  return encodeURIComponent(escapeODataKey(s));
}

// MDX bracket escape for `[Dim].[Element]` references: a `]` inside a
// name must be doubled to `]]`, otherwise the bracket identifier breaks.
/** `]` → `]]` — MDX bracket escape for names in `[...]` identifiers. */
export function escapeMdx(s: string): string {
  return s.replace(/\]/g, ']]');
}

// MDX string-literal escape for `"…"` arguments (TM1SUBSETTOSET, patterns):
// `"` is doubled, `]` stays as is. Measured on 11.8 (2026-10-02):
// `LEN("a]]b")` is 4, `LEN("a""b")` is 3 — so the bracket escape inside a
// string searches for the wrong text.
/** `"` → `""` — MDX escape for the content of a `"…"` string literal. */
export function escapeMdxString(s: string): string {
  return s.replace(/"/g, '""');
}

/**
 * Every occurrence of an element as a set — the drill target for
 * `DRILLDOWNMEMBER`/`DRILLUPMEMBER` instead of the bare `[d].[h].[name]`.
 *
 * TM1 gives each occurrence its own path (`UniqueName`
 * `[d].[h].[Parent^Child]`), and the bare reference resolves to the FIRST
 * parent only. A child that came into a set by drilling under its SECOND
 * parent is therefore never hit: the drill is a silent no-op. Measured live
 * (11.8, 2026-10-12, a production-like station dimension): element with two
 * parents, reached by drilling the second one — bare reference 11 → 11 rows,
 * this set 11 → 17. A saved static subset does not show it
 * because its list is re-resolved by name.
 *
 * `TM1FILTERBYPATTERN` narrows cheaply (37 ms on 295,090 members), the outer
 * `FILTER` makes it exact (a name with `*`/`?` is a pattern there). Pattern
 * and `=` both ignore case, as TM1 names do.
 */
export function memberOccurrencesMdx(hierRef: string, name: string): string {
  const s = `"${escapeMdxString(name)}"`;
  return `{FILTER({TM1FILTERBYPATTERN({${hierRef}.Members}, ${s})}, ${hierRef}.CurrentMember.Name = ${s})}`;
}
