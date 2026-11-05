/**
 * What the ancestor chain of the Dimension Browser should carry along per ancestor.
 *
 * Lives in `utils/` because both sides need it and neither may import the other:
 * `webviewClient/dimensionBrowser/viewTrail.ts` ORDERS the projection,
 * `tm1Rest/dimensionElementsApi.ts` builds the query from it. Same pattern as
 * `utils/dataSourceWire.ts`. A hand-written copy on each side would be two
 * truths about one wire.
 *
 * TWO independent axes: `kind` orders type and level per ancestor, `attrs`
 * the attributes. Measured live (2026-08-23, window 5000 over 1.63 million
 * occurrences, 11.8): `name` 2.85 MB, `name+element` 6.72 MB, with ALL
 * attributes 8.04 MB, with a single one 7.54 MB — time the same in each case. Hence
 * a single attribute name instead of the whole collection, and hence an
 * attribute layer does NOT order an element projection along with it.
 *
 * The path form is mandatory, not a matter of taste:
 *   `Parent($select=Name,Attributes/<attr>)`      HTTP 200
 *   `Parent($select=Name;$expand=Attributes)`     HTTP 400 „Syntax error"
 * `Attributes` is a complex type — `$expand` only as a PATH (see docs/architecture/tm1-rest-quirks.md).
 */
export interface ChainProjection {
  kind: 'name' | 'name+element';
  /**
   * Several are possible since the search follows the display alias (an
   * attribute filter under an alias search needs two). The path form carries
   * only ONE, though — with several, `buildSetExprQuery` goes for the whole
   * collection, just as for a name that is not an OData identifier.
   */
  attrs?: string[];
  /**
   * Also order ALL parents of EVERY row (`Element($expand=Parents)`).
   *
   * Needed as soon as the response is NOT in tree order (foreign expression,
   * frozen list): there the server names only ONE parent per row,
   * and in a hand-made list that is the first natural one — not the one that
   * sits above it. Measured live on `Cube A/Default` (11.8, 2026-08-23):
   * `Account 001` names `Group A`, while in the list `Total`
   * sits above it. Without all parents the display stays flat.
   *
   * Costs no extra round trip and hardly any time — the same query carries it
   * (window 200: 456 ms with, 504 ms without; +13 KB of 20 KB). Still only on
   * request: over a tree order the chain already answers the same
   * question.
   */
  parents?: boolean;
}
