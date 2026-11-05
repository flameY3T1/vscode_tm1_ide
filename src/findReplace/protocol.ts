/**
 * Message protocol of the Find/Replace webview — imported by the host
 * (webviews/findReplaceWebview.ts) and the client (webviewClient/findReplace/index.ts).
 */
import type { MatchOpts } from './matchEngine';
import type { CorpusFilter, ObjectGroup } from './model';

export interface ApplyReport {
  applied: string[];
  failed?: { object: string; error: string };
  notAttempted: string[];
  /** Selected matches skipped because the source changed since the search
   *  (verified against a fresh re-fetch); not written, surfaced as a warning. */
  skipped?: number;
}

/** Webview → extension. */
export type WebviewToHost =
  | { type: 'search'; query: string; opts: MatchOpts; filter: CorpusFilter }
  | { type: 'replace'; query: string; replacement: string; opts: MatchOpts; selected: string[] }
  | { type: 'open'; objectKind: 'process' | 'rule'; objectName: string; unit?: string; line?: number };

/** Extension → webview. */
export type HostToWebview =
  | { type: 'results'; groups: ObjectGroup[]; unreadable: string[] }
  | { type: 'report'; report: ApplyReport };
