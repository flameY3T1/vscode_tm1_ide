/**
 * Message protocol of the "Normalize Naming & Casing" webview — imported by
 * the host (webviews/tiConsistencyWebview.ts, ./handleMessage.ts) and the
 * client (webviewClient/tiConsistency/index.ts).
 */
import type { ConsistencyApplyReport, FindingGroup, RenamePlan, RuleKind, UnitKey, NamingPrefixes } from './types';
import type { NameFilter } from './filter';

/** Webview → extension. */
export type WebviewToHost =
  | { type: 'listProcesses'; filter: NameFilter }
  | { type: 'scan'; ruleKind: RuleKind; selected: string[] }
  | { type: 'preview'; ruleKind: RuleKind; groupKey: string; target: string; selected: string[] }
  | { type: 'applyGroup'; ruleKind: RuleKind; groupKey: string; target: string; selected: string[] }
  | { type: 'applyAll'; ruleKind: RuleKind; selected: string[]; targets: { groupKey: string; target: string }[] }
  | { type: 'getPrefixes' }
  | { type: 'setNamingPrefixes'; prefixes: NamingPrefixes }
  | { type: 'open'; objectName: string; unit: UnitKey; line: number };

/** Replies computed by `handleConsistencyMessage`. */
export type HandlerReply =
  | { type: 'processList'; names: string[] }
  | { type: 'groups'; ruleKind: RuleKind; groups: FindingGroup[]; unreadable: string[] }
  | { type: 'previewResult'; groupKey: string; plan: RenamePlan }
  | { type: 'report'; report: ConsistencyApplyReport }
  | { type: 'prefixes'; prefixes: NamingPrefixes };

/**
 * Extension → webview. `error` carries no payload: the client clears its
 * loading bar on ANY inbound message, so a failed request posts it only for
 * that side effect.
 */
export type HostToWebview = HandlerReply | { type: 'error' };
