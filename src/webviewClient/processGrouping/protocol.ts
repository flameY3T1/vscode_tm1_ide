/**
 * Message protocol of the process-grouping webview — imported by the host
 * (webviews/processGroupingWebview.ts) and this client.
 */
import type { ProcessGroupingMode } from '../../providers/processGroupingPure';

/**
 * Extension → webview: the panel state. Also injected as the `__pgInit`
 * global for the first render; posted again when an open panel is re-opened.
 */
export interface InitMsg {
  type: 'init';
  serverName: string;
  token: string;
  mode: ProcessGroupingMode;
  names: string[];
}

export type HostToWebview = InitMsg;

/** Webview → extension. */
export type WebviewToHost =
  | { type: 'save'; token: string; mode: ProcessGroupingMode }
  | { type: 'reset' };
