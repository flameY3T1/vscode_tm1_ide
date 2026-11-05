/**
 * Message protocol of the "Unify Variable Names" webview — imported by the
 * host (webviews/tiValueNamingWebview.ts, ./handleMessage.ts) and the client
 * (webviewClient/tiValueNaming/index.ts).
 */
import type { ConsistencyApplyReport, UnitKey } from '../tiConsistency/types';
import type { NameFilter } from '../tiConsistency/filter';
import type { ValueGroup } from './types';
import type { MultiValueVar } from '../tiLiveRange/types';

type PlanSummary = { edits: { process: string }[]; skipped: { process: string; reason: string }[] };

/** Webview → extension. */
export type WebviewToHost =
  | { type: 'listProcesses'; filter: NameFilter }
  | { type: 'scan'; selected: string[] }
  | { type: 'preview'; valueKey: string; canonical: string; selected: string[]; names?: string[] }
  | { type: 'applyGroup'; valueKey: string; canonical: string; selected: string[]; names?: string[] }
  | { type: 'applyAll'; selected: string[]; targets: { valueKey: string; canonical: string; names?: string[] }[] }
  | { type: 'open'; objectName: string; unit: UnitKey; line: number }
  | { type: 'previewSplit'; process: string; varLc: string; defId: number; newName: string }
  | { type: 'applySplit'; process: string; varLc: string; defId: number; newName: string }
  | { type: 'getExcludes' }
  | { type: 'setExcludes'; entries: string[] };

/** Replies computed by `handleValueNamingMessage`. */
export type HandlerReply =
  | { type: 'processList'; names: string[] }
  | { type: 'groups'; groups: ValueGroup[]; unreadable: string[]; multiValue: MultiValueVar[] }
  | { type: 'previewResult'; valueKey: string; plan: PlanSummary }
  | { type: 'splitPreview'; process: string; varLc: string; defId: number; plan: PlanSummary }
  | { type: 'report'; report: ConsistencyApplyReport };

/**
 * Extension → webview. `error` carries no payload: the client clears its
 * loading bar on ANY inbound message, so a failed request posts it only for
 * that side effect.
 */
export type HostToWebview = HandlerReply | { type: 'excludes'; entries: string[] } | { type: 'error' };
