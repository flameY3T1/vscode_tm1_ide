// src/tm1Rest/dimensionElementsApi.ts
//
// Element-level REST access for a dimension hierarchy: attribute and level
// definitions, the batched by-name lookup, and the set-expression requests
// (`fetchViewRows`/`fetchViewCount`) from which the Dimension Browser fetches
// its rows. Query building and answer parsing live in `dimensionSetQueryPure.ts`.
//
// The old paging path (`fetchElementPage`/`fetchElementPageMdx`,
// `fetchElementCount`, `fetchElementAttributes`, `fetchMemberStructure`,
// `evalSubsetMdx`) fell away along with the browser's old loading path
// (H6, review 2026-08-24); its handlers had already gone away before that.
//
// S2-8 (review 2026-08-02) moved this out of
// `commands/dimension/dimensionBrowserHandlers.ts` unchanged. It never had any
// panel or webview reference — the handler file was two files in a trench coat.
//
// vscode-free by rule (`tm1rest-no-vscode`): every user-facing string that an
// `assertOk` needs is a `label` PARAMETER, localized by the caller in
// `commands/`. That is the whole reason the signatures here carry labels the
// original private functions did not.
import { apiRequest, assertOk } from './client';
import type { Tm1Config } from './transport/types';
import { parseJsonSafe, parseBodySafe, odataErrorMessage } from './parseRest';
import type { ODataValueEnvelope } from './parseRest';
import type { ODataError } from './odataTypes';
import { encodeODataKey } from '../utils/odataKey';
import { buildNameFilters } from './elementQuery';
import { fetchAllPages } from './odataPaging';
import type { ChainProjection } from '../utils/chainProjection';
import {
  buildSetExprQuery, parseSetAnswer, rowAttrSelect, tuplesExpand, VIEW_COUNT_QUERY,
  type AnswerRow, type RawSetAnswer, type RowExtras,
} from './dimensionSetQueryPure';
import { _getSession } from './transport/session';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';
import { BULK_READ_CAP_MS } from './timeouts';

/**
 * The element shape the dimension browser's protocol expects, restated here so
 * the transport layer does not reach into `webviewClient/`.
 *
 * Declared as a TYPE ALIAS, not an interface, on purpose: the protocol's
 * counterparts carry an `[k: string]: unknown` index signature, and only an
 * anonymous object type gets the implicit index signature that makes it
 * assignable to one. An `interface` here would fail at the `post(...)` call.
 */
export type ElementRow = {
  Name: string;
  Type: 'N' | 'C' | 'S';
  Level: number;
  Attributes: { Name: string; Value: string | number }[];
  /**
   * The parent of this row, when the source knows it — the MDX paged path
   * delivers it along with the row (`Parent($select=Name)`), the OData path
   * does not.
   *
   * What it is for: the INDENTATION in paged mode. The rows are in index
   * order, and a row gets indented when its parent is ABOVE it — the
   * indentation claims nothing more than that. Measured live (11.8,
   * 2026-08-08, first 500 rows in index order): the parent is somewhere
   * above in 99.8% (211,833 elements), 93.2% (621 elements), and 80.8% (an
   * accounts dimension) of cases. So the rule holds even though index order
   * and hierarchy order differ.
   */
  ParentName?: string;
  /**
   * ALL parents of this row, when the source knows them — the MDX paged path
   * queries them on the element (`Parents($select=Name)`), the OData path
   * loads the edges instead.
   *
   * Why this in addition to `ParentName`: `Member.Parent` in MDX is ONE
   * parent, and in a multi-hierarchy that is a selection with no relation to
   * the displayed list. Live (11.8, `Accounts`), `Account 006` has
   * three parents — `Group B | Total | Group C` — and
   * `Member.Parent` named `Group B`, which was nowhere on screen. The
   * row stayed flat while its single-parent neighbor indented; 7,795 of the
   * 20,000 rows in the window have more than one parent, so the pattern was
   * not recognizable. The indentation needs the whole list because it looks
   * for the LONGEST visible path (`maxVisibleAncestors`).
   *
   * `undefined` means "this source doesn't know" — the caller then falls back
   * to `ParentName` (drill response, by-name lookup).
   */
  ParentNames?: string[];
  /**
   * The `UniqueName` of the row, as the server names it in THIS set —
   * `[dim].[hier].[parent^…^element]`, when the element hangs under a parent.
   *
   * This is the only reliable information about WHICH block a row belongs to;
   * it cannot be derived from the display (live 11.8, dimension `aa`,
   * 2026-08-21): in `TM1SUBSETALL`, `x` is called `xxx^x`, named individually
   * (`{[aa].[aa].[x]}`) the same element is called `d^x`, and `TM1ROLLUP`
   * keeps the qualification of its input member (`sum^a`) even though a
   * DIFFERENT parent sits immediately above it in the output. Anyone guessing
   * membership from row order is therefore right or wrong depending on the
   * expression — and the expand triangle then sometimes does nothing and
   * sometimes does the wrong thing.
   *
   * `undefined` means "this source doesn't know" (full load path via
   * `Elements`, drill responses) — there it falls back to the edge tree.
   */
  UniqueName?: string;
  /**
   * Does this row have components? Only the MDX paged path answers this
   * (`Components($top=1)` in the element expand), and it does so because no
   * edges come along in paged mode: the EXPAND CORNER must be decided from
   * the row itself.
   *
   * Why not guess it from type or level (live 11.8, alternate hierarchy of a
   * dimension with 621 elements, 2026-08-08): an element there is
   * `Consolidated`, `Level = 1`, and has `Components: []`. Type and level are
   * the same characteristic there anyway — `$filter=Type eq 3` and
   * `$filter=Level gt 0` both return 147,559 rows. Of the dimension's 36
   * roots, 25 are childless consolidations; a guessed corner would be the
   * rule there, not the exception.
   *
   * `undefined` means "this source doesn't know" (drill response, by-name
   * lookup) — the caller then falls back to the type.
   */
  HasChildren?: boolean;
};

/** A parent→child edge of a hierarchy. See `ElementRow` on why this is a type. */
export type Edge = { ParentName: string; ComponentName: string };

/** An attribute DEFINITION (name + TM1 type). See `ElementRow` on the alias. */
export type AttrDef = { Name: string; Type: string };

// TM1 returns Type either as numeric enum (1=Numeric, 2=String, 3=Consolidated —
// verified live against the REST API) or as string ("Numeric"/"Consolidated"/"String").
// Exported so every element producer normalizes the same way.
export const TYPE_MAP: Record<string | number, 'N' | 'C' | 'S'> = {
  1: 'N', 2: 'S', 3: 'C',
  Numeric: 'N', Consolidated: 'C', String: 'S',
};

// Large-dim lever 6 (2026-06-13): the global apiRequest default is 30s, which is
// too short for the Elements/Edges payload of a multi-100k-element dimension.
// Use a dedicated, generous timeout for the bulk element fetch only.
export const ELEMENT_FETCH_TIMEOUT_MS = 180_000;

function enc(s: string): string {
  return encodeODataKey(s);
}

// Structure fetch for an explicit name list: names per request, and a hard cap
// on how many the browser asks about at all. A view axis is normally tens of
// members; the cap keeps a pathological subset from firing hundreds of requests.
const MEMBER_STRUCTURE_CHUNK = 40;
const MEMBER_STRUCTURE_MAX = 2_000;
// How many chunks may be in flight at once. Measured live on 11.8: 12 names +
// `$expand=Parents` = 721 URL chars / 253 ms — so a full 2000-name run is 50
// round trips, and running them one after another leaves the list flat for
// ~12 s. Bounded rather than "all at once" on purpose: TM1 is a shared server,
// and 50 simultaneous Elements queries are a spike, not a fetch.
const MEMBER_STRUCTURE_CONCURRENCY = 5;

/** One raw element row of a by-name lookup — whatever `select` asked for. */
export interface NamedElementRow {
  Name?: string;
  Type?: string | number;
  Level?: number;
  Parents?: Array<{ Name?: string }>;
  /** Complex-type object form (`{attr: value}`), as TM1 delivers it on `Elements`. */
  Attributes?: Record<string, string | number> | Array<{ Name: string; Value: string | number }>;
}

/** The `$select`/`$expand` fragment both by-name lookups share. */
export const PARENTS_EXPAND = '$expand=Parents($select=Name)';

/**
 * Look up an explicit NAME LIST in `$filter=Name eq …` chunks.
 *
 * The one place that knows how a name list becomes requests: chunk size, the
 * hard cap, bounded concurrency, and chunk-ordered assembly. Two callers with
 * very different failure appetites share it, so the tolerance is a parameter:
 *
 * - `soft` (the outline lookup) — a rejected or non-2xx chunk is SKIPPED. Its
 *   rows stay flat, which is what the pane showed before the feature existed;
 *   throwing would cost every already-answered row its outline too.
 * - hard (the ancestor walk) — `assertOk` per chunk. A missing parent there is
 *   not a cosmetic loss but a hole in the chain the user asked to see, so the
 *   caller's `catch` gets to say so.
 *
 * `isCurrent` is the generation gate, consulted BETWEEN chunks: a run that a
 * dimension/hierarchy switch superseded stops issuing further requests instead
 * of leaving dozens queued for a hierarchy nobody is looking at. What already
 * came back is still returned.
 */
export async function fetchElementsByNames(
  base: string,
  names: readonly string[],
  select: string,
  config: Tm1Config,
  opts: { soft: boolean; label?: string; isCurrent?: () => boolean },
): Promise<{ rows: NamedElementRow[]; unanswered: number }> {
  const isCurrent = opts.isCurrent ?? ((): boolean => true);
  // Dedupe BEFORE the cap: the visible rows may legitimately hold the same
  // element twice, and one filter clause answers every occurrence of it. Cutting
  // the raw list instead would both waste cap budget on repeats and report rows
  // as unanswered that an earlier chunk already covered.
  const unique = Array.from(new Set(names.filter(Boolean)));
  const asked = unique.slice(0, MEMBER_STRUCTURE_MAX);
  const unanswered = unique.length - asked.length;
  const filters = buildNameFilters(asked, MEMBER_STRUCTURE_CHUNK);

  // One bucket per chunk rather than one shared array: with several requests in
  // flight the completion order is arbitrary, and the answer must not depend on
  // which chunk the server happened to finish first.
  const parts: NamedElementRow[][] = filters.map(() => []);
  let nextChunk = 0;
  const worker = async (): Promise<void> => {
    while (nextChunk < filters.length) {
      if (!isCurrent()) { return; }
      const i = nextChunk++;
      const url = `${base}/Elements?${select}&$filter=${encodeURIComponent(filters[i])}`;
      // Per-chunk tolerance (soft only): without the `.catch` a single dropped
      // connection left every row flat, including the ones already answered.
      const res = opts.soft
        ? await apiRequest('GET', url, undefined, BULK_READ_CAP_MS, config).catch((e: unknown) => { logRestBestEffort('dimensionElements', 'soft chunk', e); return null; })
        : await apiRequest('GET', url, undefined, ELEMENT_FETCH_TIMEOUT_MS, config);
      if (!res) { continue; }
      if (opts.soft) {
        if (!isOk(res)) { continue; }
      } else {
        assertOk(res, opts.label);
      }
      parts[i] = parseBodySafe<ODataValueEnvelope<NamedElementRow>>(res, {}).value ?? [];
    }
  };
  const lanes = Math.min(MEMBER_STRUCTURE_CONCURRENCY, filters.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));

  const rows: NamedElementRow[] = [];
  for (const part of parts) { for (const r of part) { rows.push(r); } }
  return { rows, unanswered };
}

export async function fetchDefaultMember(
  dimName: string, hierName: string, config: Tm1Config,
): Promise<string | null> {
  const url = `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')/DefaultMember?$select=Name`;
  const res = await apiRequest('GET', url, undefined, undefined, config);
  if (!isOk(res)) { return null; }
  return parseJsonSafe<{ Name?: string }>(res.body, {}).Name ?? null;
}

/** Map a raw Components row to an ElementRow (Attributes empty — not needed for tree). */
export function componentRow(e: { Name: string; Type: string | number; Level?: number }): ElementRow {
  return { Name: e.Name, Type: TYPE_MAP[e.Type] ?? 'N', Level: e.Level ?? 0, Attributes: [] };
}

/**
 * Fetch just the attribute DEFINITIONS (Name+Type) for a hierarchy — cheap, no
 * per-element values. Paged mode skips the bulk element load, so without this
 * the attribute-filter and alias dropdowns would have no options to populate.
 */
export async function fetchAttrDefs(
  dimName: string,
  hierName: string,
  config: Tm1Config,
): Promise<AttrDef[]> {
  const base = `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`;
  try {
    const res = await apiRequest('GET', `${base}/ElementAttributes?$select=Name,Type`, undefined, undefined, config);
    if (res.statusCode >= 300) { return []; }
    const defs = (parseBodySafe<{ value?: Array<{ Name: string; Type: string }> }>(res, {}).value ?? [])
      .map((a) => ({ Name: a.Name, Type: a.Type }));
    return defs;
  } catch {
    return [];
  }
}

/** A level of the hierarchy, in the shape the selection field needs. */
export interface HierarchyLevel { Number: number; Name?: string }

/**
 * The levels of a hierarchy.
 *
 * From the SERVER, not guessed from loaded elements: `Levels?$select=Name,Number`
 * costs 1 ms live (2026-08-23), while the old path needed the whole
 * dimension in memory for that (`filterUi.ts` derives it from `_allData`).
 *
 * Only levels that actually exist: `TM1FILTERBYLEVEL` against a higher one
 * SILENTLY returns 0 rows instead of an error (measured live, level 9 of a
 * dimension with 8) — an offered empty level would be a dead end with no
 * explanation.
 *
 * Swallows errors just like `fetchAttrDefs` next to it: without a list the
 * selection field stays empty, and the rest of the browser keeps working.
 */
export async function fetchHierarchyLevels(
  dimName: string,
  hierName: string,
  config: Tm1Config,
): Promise<HierarchyLevel[]> {
  const base = `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`;
  try {
    const res = await apiRequest('GET', `${base}/Levels?$select=Name,Number`, undefined, undefined, config);
    if (res.statusCode >= 300) { return []; }
    return (parseBodySafe<{ value?: HierarchyLevel[] }>(res, {}).value ?? [])
      .map((l) => ({ Number: l.Number, Name: l.Name }));
  } catch {
    return [];
  }
}

/**
 * Alias value per element for one alias attribute — only names whose alias is
 * set and differs from the name (TM1 returns '' when the alias equals the
 * name, see tm1-rest-quirks). Throws on a failed read.
 */
export async function fetchAliasValues(
  config: Tm1Config, dimName: string, hierName: string, alias: string,
): Promise<Record<string, string>> {
  const all = await fetchAttributeValues(config, dimName, hierName, alias);
  return Object.fromEntries(Object.entries(all).filter(([name, v]) => v !== name));
}

interface AttrValueRow {
  Name: string;
  // TM1 returns `Attributes` as a complex-type object; older read paths see an
  // array here. Both forms are read.
  Attributes?: Record<string, unknown> | Array<{ Name: string; Value: unknown }>;
}

/**
 * Every element's value of one attribute as text (any type); empty values left
 * out. Follows `@odata.nextLink` through `fetchAllPages`. Throws on a failed
 * read — best-effort callers (cube viewer alias labels, `}Clients` aliases)
 * catch and degrade themselves.
 */
export async function fetchAttributeValues(
  config: Tm1Config, dimName: string, hierName: string, attr: string,
): Promise<Record<string, string>> {
  const base = `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`;
  const out: Record<string, string> = {};
  await fetchAllPages<AttrValueRow>(`${base}/Elements?$select=Name${rowAttrSelect([attr])}`, config, {
    label: `fetchAttributeValues(${attr})`,
    // Alias labels are best-effort; a stalled read must not hold up the user
    // picker (it waits for names and aliases together).
    timeoutMs: BULK_READ_CAP_MS,
    onPage: (rows) => {
      for (const e of rows) {
        const v = Array.isArray(e.Attributes)
          ? e.Attributes.find((a) => a.Name === attr)?.Value
          : e.Attributes?.[attr];
        if (v !== null && v !== undefined && v !== '') { out[e.Name] = String(v); }
      }
    },
  });
  return out;
}

/**
 * Fetch a view expression. The body is a ready-made string: a chunked POST
 * without `Content-Length` is a flat HTTP 400 on TM1 11.8.
 *
 * Measured (211,852 elements, window of 200, warm): `SUBSET(.Members, …)`
 * 82 ms — even at `$skip=100000` — whereas `TM1SUBSETALL` is 610 ms
 * regardless of the window. The cost sits in evaluating the set, not in the
 * projection.
 *
 * `Cardinality` is the cardinality of the EVALUATED expression, not the
 * dimension's total count. Measured live (11.8, dimension `aa`, 10 elements
 * total, setExprCardinalityWindowProbe.js, 2026-08-21):
 *
 *   {[aa].[aa].Members}                        Cardinality  10  (= total count)
 *   {SUBSET({[aa].[aa].Members}, 0, 4)}        Cardinality   4
 *   {SUBSET({[aa].[aa].Members}, 2, 3)}        Cardinality   3
 *   {SUBSET({…large dim…Members}, 0, 201)}     Cardinality 201
 *
 * Because `fetchMdx` puts the window into the expression as `SUBSET(...)`,
 * `cardinality` under a windowed fetch is the WINDOW SIZE — NOT the
 * dimension's/hierarchy's total count. Only for an unwindowed expression
 * (plain `.Members`) do the two coincide.
 */
export async function fetchViewRows(
  mdx: string, config: Tm1Config, chain: ChainProjection = { kind: 'name' },
  alias?: string, rowAttrs: readonly string[] = [], extras: RowExtras = {},
): Promise<{ rows: AnswerRow[]; cardinality: number }> {
  // `odata.metadata=none`: strips the `@odata.id` line that TM1 otherwise
  // sends along with EVERY expanded element and EVERY parent. With the
  // 24-level chain, that is the biggest single item in the payload.
  // Measured live (11.8, large dimension, window of 20,000, Spec Block K):
  //
  //   chain 'name'         without  431 ms 14.75 MB   with  371 ms 11.37 MB
  //   chain 'name+element'  without 1070 ms 52.04 MB   with  536 ms 18.65 MB
  //
  // The known caveat — that `none` also suppresses `@odata.type`, which
  // elsewhere the NativeView/MDXView distinction depends on — does NOT apply
  // to this path: a field check across both projections shows Name,
  // UniqueName, DisplayInfo, Attributes, the full parent chain, and
  // Element.Type and Element.Level all present unchanged. `Element.Type` is
  // a property, not the type marker. That's why it is set HERE and not in
  // the transport layer — the same reasoning as with `fetchElementPageMdx`
  // above. The alias belongs in the request: without it, `parseSetAnswer`
  // falls back to `Caption` and the rows would suddenly be named
  // differently.
  const requested = alias ? [alias, ...rowAttrs] : rowAttrs;
  const res = await apiRequest(
    'POST', buildSetExprQuery(chain, requested, extras), JSON.stringify({ MDX: mdx }), ELEMENT_FETCH_TIMEOUT_MS, config,
    { Accept: 'application/json;odata.metadata=none' },
  );
  if (!isOk(res)) {
    // TM1's own message names the offending token — the one thing that helps
    // someone who mistyped the expression.
    const raw = res.body || `HTTP ${res.statusCode}`;
    throw new Error(odataErrorMessage(parseJsonSafe<ODataError>(res.body, {})) ?? raw);
  }
  const json = parseBodySafe<RawSetAnswer>(res, {});
  // -1 instead of 0 for "unknown" — as `fetchElementPageMdx` does in the same
  // file. `0` reads to every caller as "empty set", which would simply be
  // wrong here.
  return {
    rows: parseSetAnswer(json, alias, rowAttrs, extras),
    cardinality: typeof json.Cardinality === 'number' ? json.Cardinality : -1,
  };
}

/**
 * A set the server evaluated once and keeps for this session: `MemberSets(n)`.
 *
 * Why: a set over `TM1SUBSETALL` is re-evaluated in full for EVERY
 * `SUBSET(…)` window. Measured live (11.8, 2026-11-04, 211,852 elements,
 * level 0 = 27,310, window 10,001, real browser projection): `SUBSET` window
 * 827-884 ms; stored set: create + first window 853 ms, every further window
 * 263-269 ms (first byte after 10 ms, the rest is payload). Same on v12 12.5.9.
 *
 * `session` is the cookie the set was created under. On 11.8 the ordinals
 * restart at 1 per session, so after a re-login `MemberSets(1)` may be a
 * DIFFERENT panel's set — a changed cookie means "gone", never "reuse".
 */
export interface MemberSetHandle { ordinal: number; session: string | undefined }

const sessionTag = (config: Tm1Config): string | undefined => _getSession(config)?.cookie;

function throwSetError(res: { statusCode: number; body: string }): never {
  const raw = res.body || `HTTP ${res.statusCode}`;
  throw new Error(odataErrorMessage(parseJsonSafe<ODataError>(res.body, {})) ?? raw);
}

/**
 * Evaluates `mdx` once, keeps it on the server and returns the first `top`
 * rows. The ordinal comes from the BODY (`Ordinal`) — it is the key of the
 * `Location: MemberSets(n)` header, which the transport does not pass on.
 * `handle` is `null` when the server sent none; the rows are valid anyway.
 */
export async function createMemberSet(
  mdx: string, top: number, config: Tm1Config, chain: ChainProjection = { kind: 'name' },
  alias?: string, rowAttrs: readonly string[] = [], extras: RowExtras = {},
): Promise<{ rows: AnswerRow[]; handle: MemberSetHandle | null }> {
  const requested = alias ? [alias, ...rowAttrs] : rowAttrs;
  const res = await apiRequest(
    'POST', `ExecuteMDXSetExpression?$select=Ordinal,Cardinality&$expand=Tuples($top=${top};${tuplesExpand(chain, requested, extras)})`,
    JSON.stringify({ MDX: mdx }), ELEMENT_FETCH_TIMEOUT_MS, config,
    { Accept: 'application/json;odata.metadata=none' },
  );
  if (!isOk(res)) { throwSetError(res); }
  const json = parseBodySafe<RawSetAnswer & { Ordinal?: number }>(res, {});
  return {
    rows: parseSetAnswer(json, alias, rowAttrs, extras),
    handle: typeof json.Ordinal === 'number' ? { ordinal: json.Ordinal, session: sessionTag(config) } : null,
  };
}

/**
 * One window of a stored set. `null` = the set is gone (other session, or the
 * server dropped it: 404) — the caller falls back to the windowed expression.
 */
export async function fetchMemberSetPage(
  handle: MemberSetHandle, skip: number, top: number, config: Tm1Config,
  chain: ChainProjection = { kind: 'name' }, alias?: string, rowAttrs: readonly string[] = [], extras: RowExtras = {},
): Promise<AnswerRow[] | null> {
  if (sessionTag(config) !== handle.session) { return null; }
  const requested = alias ? [alias, ...rowAttrs] : rowAttrs;
  const res = await apiRequest(
    'GET', `MemberSets(${handle.ordinal})/Tuples?$skip=${skip}&$top=${top}&${tuplesExpand(chain, requested, extras)}`,
    undefined, ELEMENT_FETCH_TIMEOUT_MS, config, { Accept: 'application/json;odata.metadata=none' },
  );
  if (res.statusCode === 404) { return null; }
  if (!isOk(res)) { throwSetError(res); }
  const json = parseBodySafe<{ value?: RawSetAnswer['Tuples'] }>(res, {});
  return parseSetAnswer({ Tuples: json.value ?? [] }, alias, rowAttrs, extras);
}

/** Frees a stored set. Best effort: the session end frees it anyway. */
export async function deleteMemberSet(handle: MemberSetHandle, config: Tm1Config): Promise<void> {
  if (sessionTag(config) !== handle.session) { return; }
  try {
    await apiRequest('DELETE', `MemberSets(${handle.ordinal})`, undefined, ELEMENT_FETCH_TIMEOUT_MS, config);
  } catch (err) {
    logRestBestEffort('dimensionElementsApi', 'deleteMemberSet', err);
  }
}

/**
 * How many rows the UNwindowed expression would have.
 *
 * Why a second request at all: `fetchMdx` puts the window into the
 * expression as `SUBSET(...)`, and the `Cardinality` of a windowed
 * expression is the WINDOW size (measured live, see `fetchViewRows`). The
 * total count cannot be obtained from that. The alternative — asking
 * unwindowed and cutting via `$expand=Tuples($top;$skip)` — does deliver it
 * for free, but costs 343-461 ms instead of 88 ms and grows with the offset
 * (Spec Block G). Hence: rows cheap, count separate.
 *
 * Measured live (11.8, large dimension, Spec Block H):
 *   raw tree 345 ms · 1x EXCEPT 590 ms · type filter 1469 ms · pattern 405 ms
 *
 * Returns `-1` for "unknown" — as `fetchElementPageMdx` does in the same
 * file. `0` could be read as "empty set", which would simply be wrong.
 */
export async function fetchViewCount(mdx: string, config: Tm1Config): Promise<number> {
  const res = await apiRequest(
    'POST', VIEW_COUNT_QUERY, JSON.stringify({ MDX: mdx }), ELEMENT_FETCH_TIMEOUT_MS, config,
    { Accept: 'application/json;odata.metadata=none' },
  );
  if (!isOk(res)) {
    const raw = res.body || `HTTP ${res.statusCode}`;
    throw new Error(odataErrorMessage(parseJsonSafe<ODataError>(res.body, {})) ?? raw);
  }
  const json = parseBodySafe<RawSetAnswer>(res, {});
  return typeof json.Cardinality === 'number' ? json.Cardinality : -1;
}
