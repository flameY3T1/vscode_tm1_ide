/**
 * Cube-viewer display-alias helpers (host side).
 *
 * - `fetchDimAliasDefs`   → list of alias attribute names for a dimension
 *                           (drives the right-click "Alias" submenu).
 * - `fetchDimAliasValues` → elemName → aliasValue map for one chosen alias
 *                           (drives grid label rendering).
 *
 * Both are best-effort: any REST failure returns an empty result + a
 * best-effort log entry, never throws, so alias UX can't break the viewer.
 * Always called with the panel's Tm1Config.
 */

import { apiRequest } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { listElementAttributes } from '../../tm1Rest/dimensionApi';
import { parseBody } from '../../tm1Rest/parseRest';
import { fetchAttributeValues } from '../../tm1Rest/dimensionElementsApi';
import { logBestEffort } from '../../providers/bestEffortLog';
import { enc } from './state';
import { splitHierKey } from '../../utils/hierKeyPure';
import { isOk } from '../../tm1Rest/httpError';
import { METADATA_CAP_MS } from '../../tm1Rest/timeouts';

/** Alias attribute names for `dim` (ElementAttributes with Type === 'Alias'). */
export async function fetchDimAliasDefs(
  dim: string, config: Tm1Config,
): Promise<string[]> {
  try {
    const { dim: d, hier } = splitHierKey(dim);
    const rows = await listElementAttributes(config, d, hier, 15000);
    return rows.filter((r) => String(r.Type) === 'Alias').map((r) => r.Name);
  } catch (e) {
    logBestEffort('CubeViewer', `fetch alias defs for "${dim}"`, e);
    return [];
  }
}

/** elemName → alias value for one alias attribute. Empty values are skipped. */
export async function fetchDimAliasValues(
  dim: string, alias: string, config: Tm1Config,
): Promise<Record<string, string>> {
  if (!alias) { return {}; }
  try {
    const { dim: d, hier } = splitHierKey(dim);
    return await fetchAttributeValues(config, d, hier, alias);
  } catch (e) {
    // Deliberately also swallows CrossOriginLinkError: this helper's contract is
    // that alias lookup never breaks the viewer. `logBestEffort` keeps the
    // refusal visible, and a missing alias only costs labels, never data.
    logBestEffort('CubeViewer', `fetch alias values for "${dim}"/"${alias}"`, e);
    return {};
  }
}

interface ViewAxisEntry { Subset?: { Alias?: string; Hierarchy?: { Name?: string } } }

/**
 * Best-effort: read the display alias stored on each axis subset of a saved
 * NATIVE view, so reopening the view restores the alias. Returns dim → alias.
 * Any failure (strict server rejecting the nested $expand, MDX view, …) yields
 * an empty map and never throws.
 */
export async function fetchViewDimAliases(
  cube: string, view: string, isPrivate: boolean, config: Tm1Config,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const coll = isPrivate ? 'PrivateViews' : 'Views';
    // `Rows`/`Columns` are COMPLEX types — the option syntax `Rows($expand=…)`
    // is rejected outright (HTTP 400 "Expecting '/' after property of complex
    // type in expand path"), so it has to be the path form `Rows/Subset(…)`.
    // Getting this wrong was invisible: the 400 below turned into an empty map,
    // which is indistinguishable from "this view has no alias". The alias was
    // written correctly all along and simply never read back.
    // `Titles` belongs here too: a title dimension carries its alias just the
    // same. Measured live against `Cube A/View B` (11.8, 2026-08-23) — `Dim A`
    // -> `Name`, `Dim B` -> `ALIAS_TEXT`. Without it, the Dimension Browser for
    // a title dimension opened on raw element names while the grid next to it
    // showed the alias.
    const expand =
      'Rows/Subset($select=Alias;$expand=Hierarchy($select=Name)),'
      + 'Columns/Subset($select=Alias;$expand=Hierarchy($select=Name)),'
      + 'Titles/Subset($select=Alias;$expand=Hierarchy($select=Name))';
    const url = `Cubes('${enc(cube)}')/${coll}('${enc(view)}')?$expand=${encodeURIComponent(expand)}`;
    const res = await apiRequest('GET', url, undefined, METADATA_CAP_MS, config);
    if (!isOk(res)) {
      // An MDX view has no axis subsets at all, so TM1 answers this very query
      // with `400 "Rows" is not a property of "MDXView"` (live 11.8). That is a
      // view type without axis aliases, not a failure — its alias lives in the
      // MDX text (see mdx/dimensionPropertiesPure). Logging it would put a red
      // herring in the channel on every MDX-view open.
      const body = String(res.body ?? '');
      if (!/not a property of\s*"?MDXView/i.test(body)) {
        // Stays best-effort — an unreadable alias must not stop the view from
        // opening — but it no longer passes silently for "no alias configured".
        logBestEffort('CubeViewer', `read view aliases ${cube}/${view}`,
          new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
      }
      return out;
    }
    const v = parseBody<{ Rows?: ViewAxisEntry[]; Columns?: ViewAxisEntry[]; Titles?: ViewAxisEntry[] }>(res);
    for (const ax of [...(v.Rows ?? []), ...(v.Columns ?? []), ...(v.Titles ?? [])]) {
      const alias = ax?.Subset?.Alias;
      const dim = ax?.Subset?.Hierarchy?.Name;
      if (dim && alias) { out[dim] = alias; }
    }
    return out;
  } catch (e) {
    logBestEffort('CubeViewer', `read view aliases ${cube}/${view}`, e);
    return out;
  }
}
