// src/webviewClient/bulkDeploy/protocol.ts
// Message contract between `webviews/bulkDeployWebview.ts` (host) and
// `webviewClient/bulkDeploy/index.ts` (bundle). Types only — both sides
// import the same file, so that a renamed field is noticed at compile time
// and not only in the renderer.
import type { L10nMap } from '../_shared/l10n';
import type { DeployKind, DeployCheck } from '../../webviews/bulkDeployPure';

/** A row of the table. `check` is added once it has been checked against the target. */
export interface DeployRow {
  kind: DeployKind;
  name: string;
  /** Cube of a view, dimension of a subset; for a rule the cube itself. */
  parent?: string;
  /** Hierarchy of a subset. */
  hierarchy?: string;
  isControl: boolean;
  check?: DeployCheck;
}

/** What the host needs to transfer one item. */
export interface DeployRef {
  kind: DeployKind;
  name: string;
  parent?: string;
  hierarchy?: string;
}

/** A check result: the same identifier as the row, plus the finding. */
export interface CheckResult extends DeployRef {
  check: DeployCheck;
}

/** Result of a run, per item. */
export interface DeployOutcome extends DeployRef {
  ok: boolean;
  /** The user cancelled in a confirmation prompt — nothing was written. */
  skipped?: boolean;
  reason?: string;
  /** Written, but not completely (e.g. chore created, not activated). */
  warn?: string;
}

/** A connected server that qualifies as a target. */
export interface TargetOption { id: string; label: string; url: string }

/**
 * Job generation — same reasoning as for bulk delete: search,
 * check and run are three jobs, the host serializes nothing, and an
 * answer to a question nobody asks any more should be discarded.
 */
export interface Generational { gen: number }

export type HostToWebview =
  | { type: 'init'; l10n: L10nMap; sourceLabel: string; targets: TargetOption[] }
  /** Answer to `targets` — the list read ANEW, without sending the texts again. */
  | { type: 'targets'; targets: TargetOption[] }
  | ({ type: 'rows'; rows: DeployRow[]; failedKinds: DeployKind[] } & Generational)
  | ({
    type: 'checks'; checks: CheckResult[];
    /** Reference sources of the SOURCE server that could not be read. */
    incomplete: string[];
    /** Lists of the TARGET server that could not be read. */
    inventoryFailed: string[];
  } & Generational)
  | ({ type: 'busy'; on: boolean; label?: string } & Generational)
  | ({ type: 'error'; message: string } & Generational)
  | { type: 'done'; outcomes: DeployOutcome[] };

export type WebviewToHost =
  | { type: 'ready' }
  /** Which servers are connected NOW? (Servers connected after opening would otherwise be missing.) */
  | { type: 'targets' }
  | ({ type: 'search'; kinds: DeployKind[]; pattern: string; includeControl: boolean } & Generational)
  /** What is checked is the SELECTION, not the table: reading a view costs two calls. */
  | ({ type: 'check'; rows: DeployRef[]; targetId: string } & Generational)
  | ({ type: 'deploy'; items: DeployRef[]; targetId: string } & Generational)
  /** Open the diff of a row compared during the last check. */
  | ({ type: 'diff'; ref: DeployRef; targetId: string } & Generational);
