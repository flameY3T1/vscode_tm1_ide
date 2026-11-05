// src/webviewClient/_shared/paramPromptProtocol.ts
//
// Messages of the in-window parameter prompt (_shared/paramPrompt.ts). Kept
// apart from the DOM code so the host can import them.

/** Host → webview. Part of every protocol whose window can prompt. */
export interface ParamAsk {
  type: 'askParams';
  requestId: string;
  title: string;
  submitLabel: string;
  cancelLabel: string;
  params: Array<{ name: string; numeric: boolean; value: string; prompt: string }>;
}

/** Webview → host; `values: null` = cancelled. */
export interface ParamsAnswer { type: 'paramsAnswer'; requestId: string; values: Record<string, string> | null }
