// src/webviewClient/cellTrace/vscodeApi.ts
// The cellTrace webview client was receive-only until now (no outbound
// messages). This exposes the `acquireVsCodeApi()` bridge so `render.ts` can
// send `openRule` clicks back to the extension host (cellTracePanel.ts).
import type { TracePanelOut } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

export const vscode = getVsCodeApi<TracePanelOut>();
// For the column-drag script (webviews/columnResize.ts): the API exists only once per webview.
(window as unknown as { tm1VsApi: typeof vscode }).tm1VsApi = vscode;
