// src/tm1Rest/dimensionTreeApi.ts
//
// Hierarchy TRAVERSAL over the TM1 REST API: the upward ancestor walk.
//
// S2-8 (review 2026-08-02) moved this out of
// `commands/dimension/dimensionBrowserHandlers.ts` unchanged — none of it ever
// touched a panel. Split off from `dimensionElementsApi` because the two answer
// different questions: that one is "which elements are there", this one is "how
// are they connected".
//
// The downward-facing paths (`fetchChildren`/`fetchSubtree`) and the size
// probe (`probeSubtreeCount`) were dropped along with the Dimension Browser's
// old loading path (H6, review 2026-08-24) — the new path fetches the tree as
// a set expression via `fetchViewRows`.
//
// vscode-free by rule (`tm1rest-no-vscode`): every `assertOk` context is a
// `label` parameter, localized by the caller in `commands/`.
import type { Tm1Config } from './transport/types';
import { encodeODataKey } from '../utils/odataKey';
import {
  PARENTS_EXPAND, componentRow, fetchElementsByNames,
  type ElementRow, type Edge, type NamedElementRow,
} from './dimensionElementsApi';

function enc(s: string): string {
  return encodeODataKey(s);
}

/**
 * Fetch ancestor elements for a given element (upward walk).
 *
 * BFS upward, ONE batched query per level:
 * `Elements?$select=Name,Type,Level&$expand=Parents($select=Name)&$filter=Name eq …`
 * — the same by-name lookup (`fetchElementsByNames`), so a level's parents
 * arrive together with each member's own type and level.
 *
 * What this replaced (S2-1, review 2026-08-02): a dump of the hierarchy's WHOLE
 * `/Edges` collection (419k rows on the documented dimensions) followed by ONE
 * SEQUENTIAL single-key GET per ancestor — a five-element chain cost the entire
 * edge table plus five round trips, for information that fits in three requests.
 * `fetchElementsByNames` had been proving the cheaper shape in the sibling
 * module since paged mode was built.
 *
 * recursive=false → direct parents only (one hop).
 * recursive=true  → all ancestors transitively.
 *
 * Returns each ancestor's ElementRow plus the upward path edges, in the same BFS
 * order the edge-map walk produced.
 *
 * A level wider than `MEMBER_STRUCTURE_MAX` is truncated by the shared lookup.
 * That means 2000 DIRECT parents of one element — not a shape any hierarchy the
 * browser opens has; the cap is a ceiling against a pathological DAG, not a
 * working limit, so it is not surfaced here (unlike the outline lookup, where a
 * 2000-row view axis is ordinary).
 */
export async function fetchAncestors(
  dimName: string, hierName: string, element: string, recursive: boolean, config: Tm1Config,
  /** Localized `assertOk` context — the walk is hard-failing per level. */
  label: string,
): Promise<{ elements: ElementRow[]; edges: Edge[] }> {
  const base = `Dimensions('${enc(dimName)}')/Hierarchies('${enc(hierName)}')`;

  const elements: ElementRow[] = [];
  const edges: Edge[] = [];
  const seen: Record<string, boolean> = {};
  let frontier: string[] = [element];
  let depth = 0;

  while (frontier.length) {
    const { rows } = await fetchElementsByNames(
      base, frontier, `$select=Name,Type,Level&${PARENTS_EXPAND}`, config, { soft: false, label },
    );
    // Keyed lower-case: TM1 element names are case-insensitive and the server
    // answers in ITS canonical casing, which need not match what the webview
    // clicked on. A case-sensitive lookup would drop the whole level.
    const byName = new Map<string, NamedElementRow>();
    for (const r of rows) {
      const n = String(r.Name ?? '');
      if (n && !byName.has(n.toLowerCase())) { byName.set(n.toLowerCase(), r); }
    }

    const next: string[] = [];
    // Iterate the FRONTIER, not the response: BFS order is the frontier's order,
    // and the server may answer a chunk's rows in any order it likes.
    for (const child of frontier) {
      const row = byName.get(child.toLowerCase());
      // depth 0 is the clicked element itself — it is not one of its ancestors.
      if (depth > 0 && row) {
        elements.push(componentRow({
          Name: String(row.Name ?? child), Type: row.Type ?? 'N', Level: row.Level,
        }));
      }
      // Non-recursive stops after one hop. The second round still runs — it is
      // the only way to learn the direct parents' own type/level — but it must
      // not walk on, or "show parents" would quietly become "show ancestors".
      if (!recursive && depth > 0) { continue; }
      for (const p of row?.Parents ?? []) {
        const par = String(p.Name ?? '');
        if (!par) { continue; }
        edges.push({ ParentName: par, ComponentName: child });
        if (!seen[par]) { seen[par] = true; next.push(par); }
      }
    }
    depth++;
    frontier = next;
  }

  return { elements, edges };
}
