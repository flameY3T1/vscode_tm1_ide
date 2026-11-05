// src/webviewClient/serverConfigEditor/protocol.ts
//
// Messages between the server configuration editor and its host
// (commands/serverConfig/serverConfigEditor.ts).

/** One parameter row as the host builds it (serverConfigEditorWebview.ts#buildRows). */
export interface ConfigRowView {
  name: string;
  cluster: string;
  value: unknown;
  type: string;
  enumValues?: string[];
  requiresRestart: boolean;
  readonly: boolean;
  description: string;
  defaultValue?: unknown;
  unavailable: boolean;
}

export type WebviewToHost =
  | { type: 'reload' }
  | { type: 'save'; original: Record<string, unknown>; edited: Record<string, unknown> };

/** window.__serverConfig: the whole page state; save and reload rebuild the page. */
export interface ServerConfigBootstrap {
  rows: ConfigRowView[];
  original: Record<string, unknown>;
  /** Tab ids in order; '__raw__' is the JSON tab. */
  clusters: string[];
  initialCluster: string;
  texts: { enabled: string; disabled: string; noParams: string; notOnThisServer: string };
}

/** Kept in vscode.setState so the tab survives the page being rebuilt. */
export interface ServerConfigState { cluster?: string }
