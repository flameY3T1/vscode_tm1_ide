/**
 * The chain projection is ONE contract, not two. It lives in `utils/`
 * because neither `webviewClient` nor `tm1Rest` may import from the other.
 * Type-only import; at runtime the bundle inherits nothing from it.
 */
import type { ChainProjection } from '../../utils/chainProjection';
export type { ChainProjection };

/**
 * Discriminated-union protocol for the Dimension Browser
 * webview ↔ extension-host bridge.
 *
 * Hebel 13 (2026-05-17): single source of truth for every `postMessage`
 * shape. Both sides import from this module — host
 * (`src/commands/dimension/dimensionBrowser.ts`) and webview client
 * (`src/webviewClient/dimensionBrowser/*.ts`). vscode-free → no
 * layer violation under depcruise.
 */

import type { AncestorRef } from './rowsFromAnswer';

export type ElementType = 'N' | 'C' | 'S';

export interface ElementRow {
  Name: string;
  Type: ElementType;
  Level: number;
  Attributes: { Name: string; Value: string | number }[];
  [k: string]: unknown;
}

export interface Edge {
  ParentName: string;
  ComponentName: string;
  [k: string]: unknown;
}

export interface SubsetRef {
  name: string;
  isPrivate: boolean;
  /**
   * true = the subset is DYNAMIC on the server (non-empty MDX `Expression`).
   * Optional so older/partial producers (e.g. `setMode`'s `initialSubset`, which
   * only identifies the subset) stay assignable.
   */
  isDynamic?: boolean;
  [k: string]: unknown;
}

/** What the user selected when confirming a dimension browser selection. */
export type DimElementSelection =
  | { kind: 'elements'; names: string[] }
  | { kind: 'consolidation'; name: string }
  | { kind: 'all' }
  /**
   * The selection as an EXPRESSION instead of a list of names — what the
   * composition bar shows (`composeCurrent`).
   *
   * Only for callers that declared themselves via `acceptsExpression`. A
   * collapse state is an arrangement, not a selection: handed back as a list
   * of names, it can no longer be told apart from "the user picked 26
   * elements", and the next round can no longer keep collapsing.
   */
  | { kind: 'expression'; expression: string };

// ── Host → Webview ──────────────────────────────────────────────
export type HostToWebview =
  /**
   * "Give me your state" — the workbench asks when saving.
   *
   * The state lives HERE: `state._compose` is the intent behind the visible
   * rows (base, expansions, filters, sort order). The extension only knows
   * the dimension name of all that.
   *
   * `token` must appear in the reply — see `workbench/stateAsk.ts`.
   */
  | { type: 'requestState'; token: string }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'setError'; message: string }
  | {
      type: 'setMode';
      mode: 'standalone' | 'selection';
      multiSelect: boolean;
      allowedTypes: ElementType[] | null;
      initialSelection: string[];
      initialSubset: SubsetRef | null;
      /**
       * Set expression as the base of the page query (see
       * `DimBrowserOptions#initialSourceMdx`). Redeemed on the dimension
       * switch, not immediately — `setMode` runs BEFORE `setHierarchies`, and
       * that replaces the dimension-related state completely.
       */
      initialSourceMdx?: string | null;
      /**
       * May the answer be an EXPRESSION (`DimElementSelection` with
       * `kind: 'expression'`)? Only callers that can put MDX on their axis
       * (Cube Viewer) set this; all others keep getting names.
       */
      acceptsExpression?: boolean;
      /** Why no `initialSourceMdx` arrived — for diagnostics only. */
      initialSourceNote?: string | null;
      /**
       * Alias to open under, handed in by whoever opened the browser — the cube
       * viewer passes the alias that dimension currently shows in its grid, so
       * the two do not disagree the moment the panel appears. Treated exactly
       * like a subset's own alias: applied only if the dimension offers it.
       */
      initialAlias?: string;
      /**
       * Selection mode only: the hierarchy picker stays usable and the answer
       * names the hierarchy the user ended on. `taken` lists hierarchies the
       * caller already shows elsewhere — offered greyed out. Absent = locked.
       */
      hierSwitch?: { taken: string[] } | null;
    }
  | { type: 'setHierarchies'; hiers: string[]; selectedHier: string; selectedDim: string }
  /**
   * The remembered attribute columns of this dimension on THIS server — sent
   * on open, BEFORE the first `fetchViewRows`. If it arrives later, the first
   * window is fetched without the remembered columns and immediately reloads
   * (visible as a double load when opening any dimension).
   */
  | { type: 'attrColumns'; dimName: string; cols: string[]; widths: Record<string, number> }
  | { type: 'setSubsets'; dimName: string; hierName: string; subsets: SubsetRef[] }
  /**
   * `expression` is the subset's MDX as it stands ON THE SERVER right now
   * (`null` = static). It rides along with the elements so EVERY path that
   * loads a subset — tree `tm1.openSubset` and the in-browser dropdown alike —
   * learns whether it is dynamic, and so switching subsets can never leave the
   * previous subset's MDX cached (the cross-contamination bug).
   *
   * `dimName`/`hierName` echo the `fetchSubsetElements` request this answers, in
   * the same spirit as `setElementPage` below: every request runs its own
   * independent REST pair, so replies can land out of order and the client must
   * be able to tell which selection — and, via `subsetName`/`isPrivate`, which
   * subset — a reply belongs to. The selection half is the router-head guard
   * (`msgScope.ts#MSG_SCOPE`), the subset half stays in `msgSubset.ts`.
   */
  | {
      type: 'setSubsetElements';
      dimName: string; hierName: string; subsetName: string; isPrivate: boolean;
      elements: string[];
      expression?: string | null;
      /**
       * True when the subset's expression could NOT be read (request failed).
       * `expression: null` alone used to mean both "static subset" and "read
       * failed", so a dropped connection silently downgraded a rule-driven
       * subset to a static one — including the compose base derived from it.
       */
      expressionUnread?: boolean;
      /**
       * The subset's display alias on the server (`Alias`), or null when it was
       * saved without one. Restoring it is what makes an opened subset show the
       * member labels its author saved it under.
       */
      alias?: string | null;
    }
  | { type: 'setDefaultMember'; name: string | null }
  /**
   * P1-2/P1-2b (Stufe 4 Race-Protokolle): `dimName`/`hierName` echo the request
   * this response answers; `seq` is a host-assigned, per-panel monotonic
   * counter (assigned at request-receipt time, before any async work) so the
   * client can detect and drop a stale/out-of-order reply — a hier switch
   * (A→B) whose slow A response lands after B, or a same-dim/hier rapid
   * re-request (refresh-button double-click) whose responses arrive out of
   * order. Two guards, two questions: the dim/hier one runs once for every
   * message in the router head (`msgScope.ts`), `seq` stays in `msgElements.ts`
   * because only the list messages carry an ordering to begin with.
   */
  /** Large-dim lever 2: per-element attribute values, lazy-loaded on alias/attr-filter use. */
  /** Answer to `fetchAttrDefs`. `dimName`/`hierName` are the epoch. */
  | { type: 'attrDefs'; dimName: string; hierName: string; defs: { Name: string; Type?: string }[] }
  /** Answer to `fetchLevels`. `dimName`/`hierName` are the epoch. */
  | { type: 'levels'; dimName: string; hierName: string; levels: { Number: number; Name?: string }[] }
  /** Legacy no-op kept for backward compatibility with older host code. */
  /** `cancelled` = the host aborted the save on the user's request (dynamic-subset flatten warning declined) — not an error. */
  | { type: 'subsetSaveResult'; ok: boolean; message: string; cancelled?: boolean }
  /**
   * H3 (2026-07-05): `dimName`/`hierName` echo the `runSubsetMdx` request's
   * dim/hier (all paths, incl. errors) so the client can drop a reply that
   * lands after a dim/hier switch — same guard as `setElementPage`/`subtree`.
   */
  /**
   * The MDX of the subset the browser opened on (`editSubset`/`initialSubset`
   * prefill). `subsetName`/`isPrivate` identify WHICH subset it belongs to, so
   * the save path can refuse to write it onto a different subset.
   *
   * K11 (Review 2026-08-02): `dimName`/`hierName` echo the dim/hier the
   * expression was READ for. The host emits this from a floating promise that
   * races the `_loadDimension` await, so a reply for hierarchy A can land after
   * the user switched to B — and `expressionForSave` only compares name +
   * private flag, never dim/hier, so a late arrival would arm a FOREIGN
   * subset's MDX for the next save. Same guard family as `setSubsetElements`.
   */
  /** Whether the dimension's attribute cube `}ElementAttributes_<Dim>` exists — toggles the toolbar button. */
  | { type: 'setAttrCubeExists'; exists: boolean }
  /**
   * Answer to `drillAncestors`: the element's parents (and, recursively, their
   * parents) plus the edges connecting them.
   *
   * K11 (Review 2026-08-02): `dimName`/`hierName` echo the request — without
   * them the client could not tell an ancestor drill fired under hierarchy A
   * from one fired under B, and a late reply spliced A's elements and edges
   * into B's `_allData`. Those become visible rows, and the visible rows are
   * what a save writes. Same guard family as `subtree`/`subtreeAborted`.
   */
  | { type: 'ancestors'; dimName: string; hierName: string; element: string; elements: ElementRow[]; edges: Edge[] }
  /**
   * `requestId` belongs to the request: a reply to a superseded request is
   * discarded instead of overwriting a newer one. `dimName`/`hierName` also
   * echo the request — so the central guard (`msgScope.ts#MSG_SCOPE`) can
   * discard a reply after a hierarchy switch in the router head, just like
   * with `ancestors`/`subtree` (K11).
   */
  | { type: 'viewRows'; requestId: number; dimName: string; hierName: string; ok: true; rows: ViewAnswerRow[]; hasMore: boolean }
  | { type: 'viewRows'; requestId: number; dimName: string; hierName: string; ok: false; message: string }
  /**
   * The total count of the UNwindowed expression. A separate message because
   * it is a separate, much slower request (345-1469 ms against 139 ms for the
   * rows) — the rows must not wait for it.
   */
  | { type: 'viewCount'; requestId: number; dimName: string; hierName: string; ok: true; total: number }
  | { type: 'viewCount'; requestId: number; dimName: string; hierName: string; ok: false; message: string };

/** One row, as the host delivers it. Field-identical to `AnswerRow`. */
export interface ViewAnswerRow {
  name: string;
  caption: string;
  type: ElementType;
  level: number;
  parent: string | null;
  ancestors: AncestorRef[];
  drilled: boolean;
  /** Element index — only when `rowIndex` was ordered. */
  index?: number;
  /**
   * Edge weight to the parent, PER OCCURRENCE — only when `rowWeight` was
   * ordered. Root = 0. Evidence in
   * `tm1Rest/dimensionElementsApi.ts#AnswerRow.weight`.
   */
  weight?: number;
  /**
   * ALL parents — only ordered when the answer is NOT in tree order
   * (`viewTrail#chainFor`). `undefined` means "not ordered", empty means
   * "root".
   */
  parents?: string[];
}

/**
 * What "Apply" returns. Until 2026-08-23 it lived in `helpers.ts` (the rest of
 * the old path) and now lives with the wire, where it belongs:
 * `selectionConfirmed` carries exactly these three forms.
 */
export type SelectionPayload =
  | { kind: 'all' }
  | { kind: 'elements'; names: string[] }
  | { kind: 'expression'; expression: string };

// ── Webview → Host ──────────────────────────────────────────────
export type WebviewToHost =
  /** Reply to `requestState`. The shape belongs to the workbench, not to us. */
  | { type: 'stateReply'; token: string; state: unknown }
  | { type: 'fetchHierarchies'; dimName: string }
  /**
   * Large-dim lever 2: request per-element attribute values (alias/attr-filter).
   * In paged mode `offset`/`limit` bound the fetch to the loaded slice; omitted
   * for small dims (fetch all).
   */
  /**
   * The attribute definitions of the hierarchy — names for the selection list
   * of the attribute filter. A question of its own because the new load path
   * turns around before `fetchElements` (`msgSession.ts`) and only THERE did
   * the definitions come along so far.
   */
  | { type: 'fetchAttrDefs'; dimName: string; hierName: string }
  /**
   * The levels of the hierarchy for the level selection field. A question of
   * its own for the same reason as `fetchAttrDefs`. Only the ones that EXIST:
   * `TM1FILTERBYLEVEL` on an empty level silently returns 0 rows live instead
   * of an error — an offered empty level would be a dead end.
   */
  | { type: 'fetchLevels'; dimName: string; hierName: string }
  | { type: 'fetchSubsets'; dimName: string; hierName: string }
  | {
      type: 'fetchSubsetElements';
      dimName: string;
      hierName: string;
      subsetName: string;
      isPrivate: boolean;
    }
  | { type: 'fetchDefaultMember'; dimName: string; hierName: string }
  /**
   * Type + direct parents for a fixed name list. Asked for by the list state
   * when the browser runs paged (large dimension): no edges are loaded there,
   * so a view axis or subset order would render as an unindented flat list with
   * a wrong toggle glyph on every consolidation.
   */
  | { type: 'selectionConfirmed'; selection: DimElementSelection; displayAlias?: string; hierName?: string }
  | { type: 'openMdxRunner'; mdx: string; dim: string; hier: string }
  /**
   * `applyTo` says WHAT the reply may change:
   *  • `'source'`    — narrows the source table to the delivered names.
   *  • `'selection'` — replaces the selection list.
   *  • `'order'`     — changes ONLY the order of the source table, not the
   *    membership (server-side index sorting, `TM1SORTBYINDEX`).
   *  • absent        — free MDX run from the popup, renders the tree.
   */
  | {
      type: 'saveSubset';
      dimName: string;
      hierName: string;
      subsetName: string;
      isPrivate: boolean;
      overwrite: boolean;
      elements: string[];
      expression?: string;
      /**
       * The alias the browser is currently displaying members under, stored on
       * the subset as its `Alias`. Empty/absent means "raw names" and leaves the
       * property off the body. Overwriting PATCHes in place and clears the
       * alias (`Alias: ''`) when none is given, so a body that omits this
       * drops whatever alias the old subset had.
       */
      displayAlias?: string;
    }
  /** Open the dimension's attribute cube `}ElementAttributes_<dimName>` in the Cube Viewer. */
  | { type: 'openAttrCube'; dimName: string }
  /** Open the currently shown dimension/hierarchy in the Dimension Editor. */
  | { type: 'openDimensionEditor'; dimName: string; hierName: string }
  | { type: 'drillAncestors'; dimName: string; hierName: string; element: string; recursive: boolean }
  /**
   * P1-8b (Stufe 4 Race-Protokolle): sent once by the client after its
   * `window.addEventListener('message', ...)` handler is wired (see
   * `webviewClient/dimensionBrowser/index.ts`) — signals the host it's safe
   * to resend the init config (`setMode`/`setSubsetExpression`) if the eager
   * post fired before the listener existed. Mirrors cubeViewer / mdxRunner.
   */
  | { type: 'webviewReady' }
  /**
   * The client has already built the expression (`viewMdx.ts`) — the host only
   * fetches it. `top` is the DISPLAYED window size; the client asks for one row
   * more so that the lower window edge stays decidable. `dimName`/`hierName`
   * are the epoch for the central guard (see `viewRows`). `chain` orders the
   * ancestor projection (see `tm1Rest/dimensionElementsApi.ts#buildSetExprQuery`)
   * — `'name'` without type/level per ancestor, `'name+element'` with, for a
   * type/level layer in the filter stack; `attr` additionally for an attribute
   * layer.
   */
  | {
      type: 'fetchViewRows'; requestId: number; dimName: string; hierName: string;
      mdx: string; top: number; chain: ChainProjection;
      /**
       * The display alias: the rows are to be named under this attribute.
       * Not part of the expression — it only selects which attribute value
       * comes back as `caption`.
       */
      alias?: string;
      /**
       * Which attribute values the rows are to bring along, in selection order
       * — the host narrows its `$select` to them.
       *
       * The order goes along with EVERY fetch, not just once: it is part of the
       * request, not a reported state, and the host keeps none of it between
       * two requests. Remembering it across dimension switches and restarts
       * happens elsewhere (`attrColumnStore.ts`, via
       * `saveAttrColumns`/`attrColumns`) — this field has nothing to do with it.
       */
      rowAttrs?: string[];
      /**
       * The element index and the edge weight as columns of their own.
       *
       * Two FLAGS and not two more names in `rowAttrs`: neither of them is an
       * attribute. The index sits on the `Element` expand, the weight on the
       * member itself — whoever smuggled them into `rowAttrs` would get a
       * `$select=Attributes/…` on them and thus HTTP 400 (or the silent
       * fallback to the whole attribute collection, see `rowAttrSelect`).
       *
       * The webview carries them INTERNALLY as placeholder columns so that
       * width, order and remembering use the same machinery
       * (`attrColumns.ts#COL_INDEX`/`COL_WEIGHT`); the translation into these
       * two flags happens in ONE place (`viewFetch.ts#fetchRows`), and the host never
       * learns the placeholder names.
       */
      rowIndex?: boolean;
      rowWeight?: boolean;
      /**
       * Set only for views over `TM1SUBSETALL`: the UNwindowed expression and
       * the offset. The host then evaluates the set once (`MemberSets(n)`) and
       * pages it instead of re-evaluating it per window; `mdx` stays the
       * fallback when the stored set is gone.
       */
      page?: { setMdx: string; skip: number };
    }
  /**
   * The client has already built the UNwindowed expression (`storedMdx`) —
   * the host only fetches the total count. `dimName`/`hierName` as with
   * `fetchViewRows` the epoch for the central guard.
   */
  | { type: 'fetchViewCount'; requestId: number; dimName: string; hierName: string; mdx: string }
  /**
   * The selection OR width change of the attribute columns — sent from the
   * two places that change the state: the control callback
   * (`viewPath.ts#setAttrColumns`) and the release of the drag handle
   * (`colResize.ts#los`).
   */
  | { type: 'saveAttrColumns'; dimName: string; cols: string[]; widths: Record<string, number> };
