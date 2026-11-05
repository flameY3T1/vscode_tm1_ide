// src/webviewClient/reorderDims/protocol.ts
//
// Messages between the reorder-dimensions window and its host
// (webviews/reorderDimsWebview.ts).

export type ReorderDimsToHost = { type: 'apply'; order: string[] };
export type ReorderDimsToWebview =
  | { type: 'info'; message: string }
  | { type: 'applied'; current: string[]; counts: Record<string, number | null>; message: string }
  | { type: 'error'; message: string };

/** The JSON block #reorder-data (commands/cube/reorderDimsInit#ReorderInit). */
export interface ReorderData {
  current: string[];
  recommended: string[];
  counts: Record<string, number | null>;
}
