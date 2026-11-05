// src/webviewClient/cellSecurityBuilder/protocol.ts
//
// Messages between the cell-security builder and its host
// (commands/security/cellSecurityBuilderWebview.ts).

export type CellSecurityToHost = { type: 'create'; selected: string[] };
export type CellSecurityToWebview = { type: 'error'; message: string };
