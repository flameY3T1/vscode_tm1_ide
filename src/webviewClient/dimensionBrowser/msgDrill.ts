/**
 * Host-to-webview handler for the DRILL answers: reloaded descendants
 * (`subtree`), their abort (`subtreeAborted`) and the upward drill
 * (`ancestors`).
 *
 * S2-11 (2026-08-02): cut out of `msg.ts`, taken over unchanged.
 */

import { parentsFromEdges, showParentPicks } from './parentPick';
import type { HostToWebview } from './protocol';

export {};

/**
 * The answer to "Show parents" (`viewPath` requests it).
 *
 * Of the three drill answers of the old path (`subtree`, `subtreeAborted`,
 * `ancestors`) only this one remains: the other two answered requests that
 * only the old path made.
 */
export const drillHandlers: {
  ancestors: (msg: Extract<HostToWebview, { type: 'ancestors' }>) => void;
} = {
  ancestors: (msg) => {
    // Pass the element along: otherwise the menu cannot tell whether the list
    // belongs to the element just clicked or still to the previous one.
    showParentPicks(parentsFromEdges(msg.edges || [], msg.element), msg.element);
  },
};
