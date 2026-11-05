/**
 * Message protocol of the Chore Editor webview — imported by the host
 * (commands/chore/choreEditor.ts) and this client.
 *
 * The chore types live here
 * because the client may not import from commands/.
 */

export interface ChoreDetail {
  Name: string;
  Active: boolean;
  DST: boolean;
  /**
   * TM1 chore execution mode: whole chore = one transaction ('SingleCommit')
   * or each task commits separately ('MultipleCommit').
   *
   * `undefined` = UNKNOWN, i.e. the server did not report it. The chore-detail
   * fallback ladder in `choreApi.ts` drops `ExecutionMode` from the root
   * `$select` on servers that reject it, and TM1 11.8 then answers with no
   * `ExecutionMode` key at all (live-verified against a `SingleCommit` chore).
   * Defaulting that to 'MultipleCommit' silently rewrote the chore's
   * transaction semantics on the next save, so unknown stays unknown and
   * `buildChorePayload` OMITS the field.
   *
   * Omitting it is safe, live-verified on 11.8: a PATCH without the key leaves
   * a `SingleCommit` chore on `SingleCommit`, and a POST without it creates the
   * chore as `SingleCommit` — so 'MultipleCommit' was never the server's
   * default either, which is what made the old fallback doubly wrong.
   */
  ExecutionMode?: 'SingleCommit' | 'MultipleCommit';
  StartTime: string | null;
  Frequency: string | null;
  Tasks: ChoreTask[];
}

export interface ChoreTask {
  Step: number;
  processName: string;
  Parameters: ChoreParam[];
}

export interface ChoreParam {
  Name: string;
  Type: string; // 'String' | 'Numeric'
  Value: string;
  /** Process default value, used when a Numeric field is left empty. */
  Default?: string;
}

/** A process parameter as the host resolves it for the editor. */
export interface ProcessParamInfo {
  name: string;
  /** 'Numeric' | 'String'. */
  type: string;
  value: string;
}

/** Extension → webview. */
export type HostToWebview =
  | { type: 'initData'; isNew: boolean; processNames: string[]; chore: ChoreDetail | null }
  // `error` set = the fetch FAILED. Distinct from `params: []` ("no parameters"),
  // which would otherwise make a failed lookup look like a resolved definition.
  | { type: 'processParams'; processName: string; params?: ProcessParamInfo[]; error?: string }
  | { type: 'saveError'; message: string }
  // A save is already running for this chore — show it, but do NOT unlock the
  // buttons: the first save is still in flight.
  | { type: 'saveBusy'; message: string }
  | { type: 'saveCancelled' }
  | { type: 'saveSuccess'; choreName: string; wasNew: boolean }
  | { type: 'saveAsSuccess' };

/** Webview → extension. */
export type WebviewToHost =
  | { type: 'cancel' }
  | { type: 'getProcessParams'; processName: string }
  | { type: 'saveAs'; originalName: string; choreData: ChoreDetail }
  | { type: 'save'; isNew: boolean; originalName: string; choreData: ChoreDetail; thenExecute: boolean };
