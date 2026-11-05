// src/tm1Rest/dimensionSetQueryPure.ts
//
// The pure half of the Dimension Browser's set-expression path: the
// ExecuteMDXSetExpression query (`buildSetExprQuery`, `rowAttrSelect`,
// `VIEW_COUNT_QUERY`), the DisplayInfo bit flags and the answer parser
// (`parseSetAnswer`). No request is sent here; `dimensionElementsApi.ts`
// does that. Split out of that file (882 lines, REST mixed with builders and
// parsers) in review 2026-10-03, E3.
import type { ChainProjection } from '../utils/chainProjection';

/**
 * How deep the parent chain gets queried.
 *
 * Generous, because it costs nothing: measured live on 11.8 (`SUBSET(.Members,
 * 500, 200)` on 211,852 elements), 1, 3, 6, 12, and 20 levels all land at
 * 81-83 ms and 28-36 kB. The chain terminates on its own once the root is
 * reached — nesting beyond the hierarchy depth is free. Nesting too SHALLOW,
 * on the other hand, is expensive: then the first row of a scrolled window is
 * missing its ancestry and the whole indentation breaks.
 *
 * Verified 2026-08-21 (viewChainRoundTripProbe.js, live 11.8):
 * `aa .Members` 25 ms/10 rows, `gross` (211,852 elements) window skip=500
 * 144 ms/12 rows, window skip=100000 79 ms/5 rows. The third run is the
 * proof: the FIRST row from position 100,000 carries a five-level ancestor
 * chain — exactly the case where the stack approach from Plan 1 failed (it
 * would have drawn it at depth 0).
 */
export const PARENT_NEST_DEPTH = 24;


/**
 * The chain. `extra` hangs off EVERY level, not only the outermost one — a
 * type filter asks about the ancestor at position 12 just as much as the one
 * at position 1.
 */
function nestedParentExpand(depth: number, sel: string, extra: string): string {
  let inner = `$select=Name${sel}${extra}`;
  for (let i = 0; i < depth; i++) { inner = `$select=Name${sel}${extra};$expand=Parent(${inner})`; }
  // The outermost layer no longer carries its own `Parent(` — otherwise it
  // would be one level too many and the counter in the test would miscount.
  const head = `$select=Name${sel}${extra};$expand=Parent(`;
  return inner.startsWith(head) ? inner.slice(head.length).replace(/\)$/, '') : inner;
}

/**
 * The projection that fully describes a row (measured live on 11.8,
 * 2026-08-21).
 *
 * `Parent` delivers the parent of THIS row — nesting it out therefore carries
 * the whole ancestor chain. The `UniqueName` does NOT work for this: TM1 only
 * qualifies on ambiguity (`d^a`, but plain `c`) and assigns the same
 * `UniqueName` to two different rows.
 *
 * Type/level of EVERY chain level only comes along on request (`chain:
 * 'name+element'`) — measured (Spec Block D, 211,852 elements, window of 200
 * at skip=100,000):
 *   'name'          275 ms · URL   826 chars · response 110 kB
 *   'name+element'  277 ms · URL 1,711 chars · response 381 kB (measured
 *                    against the expression `buildSetExprQuery` actually
 *                    generates; the earlier figure of 1,506 came from a
 *                    differently shaped probe query — time/payload remain
 *                    correct)
 * So it is free in time; only the payload is paid for. That is why the
 * caller ORDERS what it needs, instead of expanding it across the board
 * here.
 */
/** What TM1's OData parser lets through in `Attributes/<name>`. */
const ODATA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The `Attributes` part of the ROW-level `$select`.
 *
 * Two independent axes, not to be confused: `chain.attrs` orders the
 * attributes of the ANCESTORS (for the indentation search), `rowAttrs` those
 * of the row itself (for the display columns).
 *
 * `Caption` is always included — `parseSetAnswer` falls back to it when the
 * chosen alias is missing.
 *
 * Measured live on 11.8, 2026-08-25 (m7RowAttrPayloadProbe.js,
 * witness with 0 bytes of drift):
 *   - The path form carries up to 103 attributes side by side at ROW level
 *     (HTTP 201, all values present, URL 3,815 characters). The note below
 *     saying "the path form carries only ONE" applies to the parent level.
 *   - On `Capex_WBS` (109 attributes), the full collection costs
 *     0.93 kB/row, Caption+2 only 0.49 kB — the narrowing saves 47% there.
 *   - A name without identifier shape (`Technischer Platz`) fails with 400 in
 *     ALL four forms. Then the whole collection: the value comes through,
 *     only the savings are lost. That is exactly today's state.
 */
export function rowAttrSelect(rowAttrs: readonly string[]): string {
  const unique = [...new Set(rowAttrs.filter(Boolean))].filter((a) => a !== 'Caption');
  if (unique.some((a) => !ODATA_IDENTIFIER.test(a))) {
    return ',Attributes';
  }
  return ',Attributes/Caption' + unique.map((a) => `,Attributes/${a}`).join('');
}

/**
 * Two fields that are NOT attributes and therefore don't fit into `rowAttrs`:
 * the element index sits on the `Element` expand, the edge weight on the
 * `Member` itself. Both only on REQUEST — they cost payload (measured live on
 * 11.8, large dimension, window of 20,000, witness with 0 bytes of drift):
 *
 *   without       6.797 MB   356.4 B/row
 *   + Index       7.054 MB   369.8 B/row   (+13.4)
 *   + Weight      7.007 MB   367.4 B/row   (+13.4)
 *   + both        7.264 MB   380.8 B/row   (+24.4 = +6.9%)
 *
 * Not measurable in time: 891-1336 ms across the series, the witness landed
 * at 1040 ms right in the middle of the variants. Only the payload is paid
 * for — the same situation as with `rowAttrs`, and therefore the same
 * answer: the caller orders what it needs.
 */
export interface RowExtras {
  /** Also request `Element.Index`. */
  index?: boolean;
  /** Also request `Member.Weight`. */
  weight?: boolean;
}

/**
 * The `Tuples` projection alone (`$expand=Members(…)`) — what goes inside
 * `Tuples(…)` on the POST and, as a plain query option, onto
 * `GET MemberSets(n)/Tuples` when paging a stored set.
 */
export function tuplesExpand(
  chain: ChainProjection,
  rowAttrs: readonly string[] = [],
  extras: RowExtras = {},
): string {
  let extra: string;
  switch (chain.kind) {
    case 'name': extra = ''; break;
    case 'name+element': extra = ';$expand=Element($select=Type,Level)'; break;
    default: {
      const unreachable: never = chain.kind;
      throw new Error(`unbekannte Kettenprojektion: ${JSON.stringify(unreachable)}`);
    }
  }
  // Attributes belong in the `$select` as a PATH, not in an `$expand`:
  // `Parent($select=Name;$expand=Attributes)` is HTTP 400 "Syntax error",
  // `Parent($select=Name,Attributes/<attr>)` returns 200 (live 2026-08-23).
  // Therefore hooked in BEFORE the `;` — after it, it would be an expand again.
  //
  // BUT the path form only tolerates simple identifiers. Measured live on a
  // dimension whose attributes are named `X+Name` (codepoint 43 — an actual
  // plus SIGN IN THE NAME) and `5-Stellig`: raw, `encodeURIComponent`, and
  // quoting all three fail with 400. There is no escaping here that helps —
  // only the fallback to the whole collection, which carries the value
  // cleanly (52 kB versus 148 kB per window of 5000 on this dimension).
  //
  // Second limit of the same path form, measured live on 11.8 on 2026-08-08
  // (the finding lived only in the test of the removed `elementQuery` path
  // until 2026-08-25): even with an identifier-capable name, it only
  // resolves for attributes of type ALIAS. `contains(tolower(Attributes/NAME),
  // 'burg')` returns 200 (260 hits, 433 ms); the same against a Numeric or
  // String attribute returns 400 "did not resolve to a value". Anyone who
  // wants to SEARCH attribute values, rather than just read them along,
  // therefore needs MDX `Properties()` — that can handle any type and any
  // name. Price on 211,852 elements: 990 ms versus 460 ms, of which 693 ms is
  // materializing `TM1SUBSETALL` alone.
  const attrs = chain.attrs ?? [];
  // The path form carries exactly ONE attribute. With several — or with a
  // name TM1's OData parser doesn't accept — the whole collection.
  //
  // The ROW (not the chain) needs at least `Caption` as a fallback to the
  // element name when the alias is missing. `rowAttrSelect(rowAttrs)` (see
  // the JSDoc above) orders this leanly: only the attributes actually used
  // instead of the whole collection. The gain depends on the dimension size:
  //
  // Measured savings (review finding M7, 2026-08-25):
  //
  // 1. Large dimension (1 attribute), window 2,000/5,000/10,000 @skip=100k:
  //    collection                          3,603 kB   ← old
  //    only `Attributes/Caption`           3,539 kB   -1.8% ← new
  //    That saves almost nothing — once Caption and the alias are both
  //    needed, the path form and the collection cost exactly the same to the
  //    byte. The gain sits in the chain, not in the rows: `name` instead of
  //    `name+element` saves 35.8% there.
  //
  // 2. `Capex_WBS` (109 attributes, measured in
  //    `m7RowAttrPayloadProbe.js`):
  //    collection                          0.93 kB/row
  //    only `Attributes/Caption`           0.49 kB/row  -47%
  //    The saving is substantial. It grows the more attributes the dimension
  //    has. Hence the narrowing: it saves nothing on dimensions with few
  //    attributes and 47% on large ones. It isn't free either (HTTP URL
  //    length with many paths), which is why there is a fallback to the
  //    collection for unparseable names — see `rowAttrSelect`.
  const sel = attrs.length === 0 ? ''
    : (attrs.length === 1 && ODATA_IDENTIFIER.test(attrs[0]!)
      ? `,Attributes/${attrs[0]}` : ',Attributes');
  // All parents of the ROW (not the chain) only on request — see
  // `ChainProjection#parents` for the reason and measurement.
  //
  // `Index` hangs off the ROW-level element expand (which exists anyway),
  // `Weight` directly off the member — both only when requested (see
  // `RowExtras`).
  const elementSel = 'Type,Level' + (extras.index ? ',Index' : '');
  const rowElement = chain.parents
    ? `Element($select=${elementSel};$expand=Parents($select=Name))`
    : `Element($select=${elementSel})`;
  const memberSel = 'Name,UniqueName,DisplayInfo' + (extras.weight ? ',Weight' : '');
  return `$expand=Members($select=${memberSel}${rowAttrSelect(rowAttrs)};`
    + `$expand=Parent(${nestedParentExpand(PARENT_NEST_DEPTH, sel, extra)}),${rowElement})`;
}

export function buildSetExprQuery(
  chain: ChainProjection,
  rowAttrs: readonly string[] = [],
  extras: RowExtras = {},
): string {
  return `ExecuteMDXSetExpression?$select=Cardinality&$expand=Tuples(${tuplesExpand(chain, rowAttrs, extras)})`;
}

/** Today's form — unchanged, so existing callers notice nothing. */
export const SET_EXPR_QUERY = buildSetExprQuery({ kind: 'name' });

/** XMLA `DISPLAY_INFO`, re-measured against TM1 11.8. */
// The neighbouring bits, unused here: 0x20000 parent same as previous member,
// 0x40000 has next sibling.
export const DRILLED_DOWN = 0x10000;

export interface RawSetParent {
  Name?: string;
  Parent?: RawSetParent | null;
  /** Only filled for `chain: 'name+element'`. */
  Element?: { Type?: string; Level?: number };
  /** Only filled for requested `chain.attrs`. */
  Attributes?: Record<string, string | number | null>;
}
export interface RawSetMember {
  Name?: string;
  UniqueName?: string;
  DisplayInfo?: number;
  /**
   * `Caption` is the default alias; the remaining keys are the attributes
   * the caller requested. Index access is necessary since the display uses a
   * freely chosen alias as the label.
   */
  Attributes?: { Caption?: string } & Record<string, string | number | null | undefined>;
  Parent?: RawSetParent | null;
  /** Only for `RowExtras.weight` — the edge weight to the parent. */
  Weight?: number;
  /** `Parents` only for `chain.parents` — see `ChainProjection#parents`. */
  Element?: { Type?: string; Level?: number; Index?: number; Parents?: { Name?: string }[] };
}
export interface RawSetAnswer {
  Cardinality?: number;
  Tuples?: { Members?: RawSetMember[] }[];
}

/** An ancestor — as much as a filter predicate needs to know about it. */
export interface AncestorRef {
  name: string;
  type: 'N' | 'C' | 'S';
  level: number;
  /** Only filled when `chain.attr` was requested (then with exactly that one). */
  attrs?: Record<string, string> | undefined;
}

/** A row, as the server describes it — still without depth. */
export interface AnswerRow {
  name: string;
  caption: string;
  type: 'N' | 'C' | 'S';
  level: number;
  /** The parent of THIS row; `null` for a root. */
  parent: string | null;
  /** Are this row's children right behind it here? */
  drilled: boolean;
  /**
   * The values of the REQUESTED display columns. If the field is missing,
   * nothing was requested; if a key inside it is missing, the value is
   * empty — TM1 leaves out empty attribute values (measured live on 11.8: 45
   * of 109 keys on 300 elements). Values are strings so the display doesn't
   * have to guess whether it should format a number.
   */
  attrs?: Record<string, string>;
  /**
   * The element index — the order in which TM1 keeps the element in the
   * hierarchy. Only filled when `RowExtras.index` was requested; `undefined`
   * means "not requested", not "index 0".
   */
  index?: number;
  /**
   * The edge weight between this row and its parent — PER OCCURRENCE, not
   * per element.
   *
   * Measured live on 11.8 (2026-08-25): `Member.Weight` is exactly the weight
   * of the edge to the parent under which the member is qualified in THIS
   * set. Evidence — the same element under two parents:
   *   `[Monate].[Monate].[M02^PQ01n]` -> -1  (edge M02->PQ01n = -1)
   *   `[Monate].[Monate].[M01^PQ01n]` ->  1  (edge M01->PQ01n =  1)
   * A root with no parent carries 0. This matches the browser's occurrence
   * model (`rowKey`) and NOT a view of "one weight per element" — there is no
   * such thing in a multi-hierarchy.
   *
   * Only filled when `RowExtras.weight` was requested.
   */
  weight?: number;
  /**
   * The ancestors of this row, ROOT FIRST, without the row itself.
   *
   * Without it, the indentation of a scrolled window cannot be derived: the
   * ancestors of the window's first row sit above the window (finding of
   * Plan 1's closing review).
   *
   * OPEN ASSUMPTION: that `Parent.Parent` follows the same OCCURRENCE (and
   * does not, say, jump to a different occurrence of the same element under
   * multiple parentage) is only proven live for ONE level — dimension `aa`,
   * the same element under `sum` and under `d` each names the correct
   * parent. For level 2 and deeper this is UNMEASURED; two attempts by the
   * controller did not answer it. No guarantee until that is caught up on.
   *
   * `type`/`level` per ancestor are only real for `chain: 'name+element'` —
   * for `'name'` (today's unchanged path) they stand at `'N'`/`0`, because
   * the server does not deliver an `Element` there (see `buildSetExprQuery`).
   */
  ancestors: AncestorRef[];
  /**
   * ALL parents of this row — only filled for `chain.parents`.
   *
   * `undefined` means "not requested", not "no parents": an empty array is
   * the statement of a root and must stay distinguishable from that.
   *
   * Why this, when `parent`/`ancestors` already exist: those name ONE path
   * upward, and over a foreign set that is the natural one, not the visible
   * one (live `Cube A/Default`, 2026-08-23). For indentation, however,
   * what counts is whether a parent is ACTUALLY sitting above the row.
   */
  parents?: string[];
}

const SET_TYPE: Record<string, 'N' | 'C' | 'S'> = {
  Numeric: 'N', Consolidated: 'C', String: 'S',
};

/**
 * Convert the attribute values of a chain level into plain strings.
 *
 * TM1 returns numeric attributes as a JSON number; the comparison in the
 * predicate (`filterPredicate.ts`) is a substring search and needs text.
 * `null` is dropped rather than becoming `"null"` — otherwise a search for
 * "ull" would hit every empty attribute.
 */
function attrsOf(raw: Record<string, string | number | null> | undefined):
Record<string, string> | undefined {
  if (!raw) { return undefined; }
  const out: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (v !== null && v !== undefined) { out[k] = String(v); }
  }
  return out;
}

/** Only the requested values, empty ones left out, everything as a string. */
function chosenAttrs(
  raw: RawSetMember['Attributes'],
  requested: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) { return out; }
  for (const name of requested) {
    const v = (raw as Record<string, unknown>)[name];
    if (v === undefined || v === null || v === '') { continue; }
    out[name] = String(v);
  }
  return out;
}

export function parseSetAnswer(
  json: RawSetAnswer, alias?: string, rowAttrs?: readonly string[],
  extras: RowExtras = {},
): AnswerRow[] {
  const out: AnswerRow[] = [];
  // Only COUNT in the loop, report afterward: the window is 10,000 rows in
  // size, and building a warning per row on every reload (template string,
  // synchronous) cost more than the parsing itself. The first affected name
  // is kept as evidence — the statement doesn't change, only how often it
  // goes out.
  let truncated = 0;
  let firstTruncated = '';
  for (const t of json.Tuples || []) {
    for (const m of t.Members || []) {
      const name = m.Name || '';
      if (!name) { continue; }
      const di = m.DisplayInfo || 0;
      const ancestors: AncestorRef[] = [];
      // Collect upward from the row, then reverse: the display needs the
      // root first. The cap guards against a cycle in a broken hierarchy —
      // the server doesn't deliver more levels anyway.
      let up = m.Parent;
      for (let i = 0; up && i < PARENT_NEST_DEPTH; i++) {
        if (up.Name) {
          ancestors.push({
            name: up.Name,
            // Without `Element` (request 'name') the type is unknown. 'N'/0
            // here is NOT a claim but the unused case: anyone tracking a
            // type/level layer requests 'name+element'.
            type: SET_TYPE[(up.Element && up.Element.Type) || ''] || 'N',
            level: (up.Element && up.Element.Level) || 0,
            // `undefined` instead of `{}` when nothing was requested: an
            // empty object would claim "this ancestor has no attributes",
            // and the two cases would no longer be distinguishable later.
            attrs: attrsOf(up.Attributes),
          });
        }
        up = up.Parent;
      }
      // Truncated vs. a real root is distinguishable (measured live on 11.8,
      // parentNestTruncationProbe.js, 2026-08-21):
      //   nest( 1)  last link SITE2021_200011_C  -> `Parent` field MISSING   (truncated)
      //   nest( 2)  last link SITE2021_200012_C  -> `Parent` field MISSING   (truncated)
      //   nest(12)  last link Alle_Einzeleleme -> `Parent: null`           (real root)
      // A real root is delivered by the server as an explicit `Parent: null`
      // (which lets the loop above end normally with `up === null`). If the
      // field is missing entirely instead (`up === undefined`), it simply
      // was not requested anymore at depth `PARENT_NEST_DEPTH` — the chain
      // CAN be cut short here without the hierarchy actually having ended.
      // No `throw`: a hierarchy that is too deep is not a hard error, only a
      // wrong indentation — the display should keep running, but report it
      // visibly (console).
      if (up === undefined) {
        truncated++;
        if (!firstTruncated) { firstTruncated = name; }
      }
      ancestors.reverse();
      out.push({
        name,
        // Order chosen deliberately: the selected alias, otherwise `Caption`
        // (the default alias), otherwise the name. The last step is not a
        // cosmetic flaw — live on 11.8, TM1 does NOT deliver the alias value
        // when it equals the name; without the fallback the row would then
        // have no text at all.
        caption: String(
          (m.Attributes && ((alias && m.Attributes[alias]) || m.Attributes.Caption)) || name,
        ),
        type: SET_TYPE[(m.Element && m.Element.Type) || ''] || 'N',
        level: (m.Element && m.Element.Level) || 0,
        parent: (m.Parent && m.Parent.Name) || null,
        drilled: (di & DRILLED_DOWN) !== 0,
        ...(rowAttrs && rowAttrs.length ? { attrs: chosenAttrs(m.Attributes, rowAttrs) } : {}),
        // Only take it over when REQUESTED and delivered by the server. The
        // check against `undefined` (not `||`) is the point: index and
        // weight are both legitimately 0 — a root carries weight 0 (measured
        // live), and an `|| undefined` would silently turn that into "not
        // requested".
        ...(extras.index && typeof m.Element?.Index === 'number'
          ? { index: m.Element.Index } : {}),
        ...(extras.weight && typeof m.Weight === 'number' ? { weight: m.Weight } : {}),
        ancestors,
        // Only pass it on when the server filled the field at all — otherwise
        // an empty array would claim "this row has no parents".
        ...(m.Element && m.Element.Parents
          ? { parents: m.Element.Parents.map((p) => p.Name || '').filter(Boolean) }
          : {}),
      });
    }
  }
  if (truncated) {
    console.warn(
      `[dimensionBrowser] ancestor chain truncated at depth ${PARENT_NEST_DEPTH} `
      + `— the server no longer delivered the field \`Parent\` there: `
      + `${truncated} of ${out.length} rows affected (e.g. '${firstTruncated}').`,
    );
  }
  return out;
}

/**
 * The query for the total count: ONLY `Cardinality`, no `$expand`.
 *
 * That is the whole trick — the response is 112 bytes in size, no matter how
 * large the set is. An `$expand=Tuples` here would make it as expensive as
 * the row fetch.
 */
export const VIEW_COUNT_QUERY = 'ExecuteMDXSetExpression?$select=Cardinality';
