/**
 * The wiring between a fully built grid and `picklistApi.ts` — everything a
 * `cellData` sender needs to send the picklist maps along.
 *
 * Why a separate module and not `messaging.ts`: the path for SAVED views
 * lives in `view.ts`, and `messaging.ts` imports `view.ts` — a back-import
 * would close a cycle, which `npm run lint:deps` reports as a build breaker.
 * Both callers depend on this module, which itself knows neither of them.
 *
 * What is NO LONGER here (task 15, 2026-08-13): reading the cell level across
 * the whole grid. It is deleted, not switched off. Measured against 11.8,
 * querying it over the window of a real saved view cost **over ten
 * minutes** and had to be aborted server-side, while the same view showed
 * exactly ONE cell with a picklist; 417 cells in one cellset cost 12.5 s, ONE
 * cell 1-2 ms, the rule text 1 ms. The control cube is not expensive per
 * cell, but with cellset size — so the surface now comes from the rule text
 * and everything else individually on request.
 *
 * The binding requirement remains unchanged: picklists must NEVER cost the
 * view anything. Every error path in `picklistApi` ends in an empty result
 * instead of a throw.
 */
import type { Tm1Config } from '../../tm1Rest/transport/types';
import {
  fetchElementPicklists, fetchRulePicklists, hasPicklistCube,
  invalidatePicklistResolutions, disposePicklistCachesForServer,
} from './picklistApi';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

/** What a fully built grid can say about its axes. Covers the `cellData`
 *  matrix just as much as the cellset result (there the fields are not
 *  optional). */
export interface PicklistMatrixLike {
  rowDims?: string[];
  colDims?: string[];
  titleAssignments?: Record<string, string>;
}

/**
 * The cube's dimensions, derived from the matrix instead of looked up via
 * `Cubes('<c>')/Dimensions`: a cellset always covers ALL of the cube's
 * dimensions — some sit on the axes, the rest arrive as title axes (ordinal
 * >= 2) in `titleAssignments` (`cellParse.ts#parseTitleAndTuples`). This
 * saves one REST request per refresh and cannot throw.
 */
export function _picklistDims(m: PicklistMatrixLike): string[] {
  return [...new Set([
    ...(m.rowDims ?? []), ...(m.colDims ?? []), ...Object.keys(m.titleAssignments ?? {}),
  ])];
}

/**
 * Hook for disconnecting from the server (registered in `extension.ts`):
 * every cache in `picklistApi` is dropped. Otherwise a 404 for the control
 * cube would survive disconnecting and reconnecting, even though a different
 * state may now be on the server.
 */
export function disposePicklistStateForServer(serverUrl: string): void {
  if (!serverUrl) { return; }
  disposePicklistCachesForServer(serverUrl);
}

// The picklist caches belong to the server, not to the panel: a 404 from the
// control cube or an attribute map would otherwise survive a disconnect and
// reconnect, even though the server has a different state by now.
registerServerDisposer('picklists', (url) => disposePicklistStateForServer(url));

/**
 * The two SURFACE-WIDE picklist maps for the grid just built, raw.
 *
 * Cost per refresh: one attribute-list query per cube dimension (plus one
 * element list only where a `Picklist` attribute actually exists) and ONE
 * `GET .../Rules` — both cached, both without a cell query. The control
 * cube is never queried over more than zero cells; that is this task's
 * regression guard.
 *
 * Runs ALONGSIDE building the axis metadata (the same `Promise.all`), never
 * before it: the added wait time is that of the metadata that is running
 * anyway.
 *
 * This function is also THE refresh hook (spec §E3): it runs on every
 * rebuild of a grid and only there, which is why the resolved definitions
 * and the single-cell responses for this server are discarded here. A
 * picklist changed in TM1 would otherwise stay stale for the whole session.
 */
export async function _picklistMaps(
  config: Tm1Config, cubeName: string, dims: string[],
): Promise<{
  picklistByElem: Record<string, Record<string, string>>;
  picklistByRuleElem: Record<string, string>;
  picklistCubePresent: boolean;
}> {
  invalidatePicklistResolutions(config.serverUrl);
  // The existence question ALONGSIDE the attribute map, the rule text only
  // after that: `fetchRulePicklists` asks the same question itself first,
  // and on the first open the cache is still empty — started in parallel,
  // both would fire off the same GET. Doing it sequentially costs nothing
  // (the second question hits the warm cache), and without a control cube
  // the rule call is skipped entirely. The answer also tells the client
  // whether the single-cell query on double-click could find anything at
  // all.
  const [picklistByElem, picklistCubePresent] = await Promise.all([
    fetchElementPicklists(config, dims),
    hasPicklistCube(config, cubeName),
  ]);
  const picklistByRuleElem = picklistCubePresent
    ? await fetchRulePicklists(config, cubeName)
    : {};
  return { picklistByElem, picklistByRuleElem, picklistCubePresent };
}
