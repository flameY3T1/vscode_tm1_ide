// src/webviewClient/createCube/protocol.ts
//
// Messages between the "New Cube" dialog and its host
// (commands/cubeViewer/createCube.ts).

export type WebviewToHost =
  | { type: 'cancel' }
  | { type: 'submit'; name: string; dimensions: string[] };

export type HostToWebview = { type: 'validationError'; message: string };

/** window.__createCube: dimension names and the one client-side text. */
export interface CreateCubeBootstrap {
  dimensions: string[];
  texts: { minDims: string };
}
