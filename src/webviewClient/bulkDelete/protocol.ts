// src/webviewClient/bulkDelete/protocol.ts
// Message contract between `webviews/bulkDeleteWebview.ts` (host) and
// `webviewClient/bulkDelete/index.ts` (bundle). Types only — both sides
// import the same file, so that a renamed field is noticed at compile time
// and not only in the renderer.
import type { L10nMap } from '../_shared/l10n';
import type { UsageInfo } from '../../webviews/bulkDeletePure';
import type { ObjKind } from '../../utils/objectKinds';

/** A row of the table. `usage` is added once the reference index is ready. */
export interface BulkRow {
  kind: ObjKind;
  name: string;
  /** Cube of a view or dimension of a subset; otherwise not set. */
  parent?: string;
  /** Hierarchy of a subset — `deleteSubset` needs it besides the dimension. */
  hierarchy?: string;
  isControl: boolean;
  usage?: UsageInfo;
}

/** A check result: the same identifier as the row, plus the finding. */
export interface UsageResult extends DeleteItem {
  usage: UsageInfo;
}

/** What the host needs to delete one item. */
export interface DeleteItem {
  kind: ObjKind;
  name: string;
  parent?: string;
  hierarchy?: string;
}

/** Result of a run, per item. */
export interface DeleteOutcome extends DeleteItem {
  ok: boolean;
  reason?: string;
  /**
   * Not touched because the user cancelled the run. Counts neither
   * as a success nor as an error — the report must not name more deletions
   * than there were.
   */
  skipped?: boolean;
}

/**
 * Job generation.
 *
 * Search and check run concurrently, and the host serializes nothing.
 * Two searches in quick succession can come back in reverse order,
 * and a check started before the reload would otherwise put its
 * results on a completely different table. The renderer increments the
 * generation, the host passes it back unchanged, and whatever does not belong to the
 * current generation is discarded — including its
 * `busy` state, which would otherwise clear the notice of a still-running search.
 */
export interface Generational { gen: number }

export type HostToWebview =
  | { type: 'init'; l10n: L10nMap; serverLabel: string; kinds: ObjKind[] }
  | ({ type: 'rows'; rows: BulkRow[]; failedKinds: ObjKind[] } & Generational)
  /**
   * Every result carries the FULL identifier of its row, not just kind and
   * name. The renderer matches via `rowKey`, which also covers parent object and
   * hierarchy — otherwise `Sales / Monthly` found no row, and two
   * subsets of the same name in different hierarchies
   * collided in the map.
   */
  | ({
    type: 'usage'; usage: UsageResult[]; incomplete: string[];
    /** Processes whose data source comes from a variable in the code. */
    dynamicDataSources: string[];
  } & Generational)
  | ({ type: 'busy'; on: boolean; label?: string } & Generational)
  | ({ type: 'error'; message: string } & Generational)
  | { type: 'done'; outcomes: DeleteOutcome[] };

/**
 * Searching and checking dependencies are TWO jobs.
 *
 * On a large instance, listing costs six queries and checking additionally costs
 * every process text, every rule text and every chore. Running both unasked
 * when the page opens loads a multiple of what
 * the user wants to see. `search` fetches exactly the checked kinds,
 * `analyze` checks exactly the rows that are then in the table.
 */
export type WebviewToHost =
  | { type: 'ready' }
  /**
   * The full dependency view for ONE row. The column names the
   * objects, the existing `tm1.findReferences` window shows them grouped,
   * with section, line and source line — and opens each of them on
   * click. Building a second list with the same links next to it
   * would be the same view a second time.
   */
  | { type: 'openUsage'; kind: ObjKind; name: string }
  | ({ type: 'search'; kinds: ObjKind[]; pattern: string; includeControl: boolean } & Generational)
  | ({ type: 'analyze'; rows: DeleteItem[] } & Generational)
  // The delete run also carries the generation: its `busy` belongs to the same
  // count, otherwise the end of an old search hides it.
  | ({ type: 'delete'; items: DeleteItem[] } & Generational);
