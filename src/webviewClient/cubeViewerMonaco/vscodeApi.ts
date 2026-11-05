/**
 * Centralised VS Code webview API handle.
 *
 * `acquireVsCodeApi()` may only be called ONCE per webview. Importing this
 * module from any other webview module yields the same singleton instance.
 */

import type { WebviewToHost } from './protocol';
import { getVsCodeApi } from '../_shared/vscodeApi';

export const vscode = getVsCodeApi<WebviewToHost>();
