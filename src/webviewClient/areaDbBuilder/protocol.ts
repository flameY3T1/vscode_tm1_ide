export type BuilderMode = 'DB' | 'AREA';

export interface ElementRow {
  name: string;
  aliases: string[];
}

// Host → Builder webview
export type HostToBuilder =
  | { type: 'init'; currentCube: string; cubes: string[] }
  | { type: 'dims'; cube: string; dims: string[] }
  | { type: 'elements'; dim: string; query: string; rows: ElementRow[]; skip: number; hasMore: boolean }
  | { type: 'error'; message: string };

// Builder webview → Host
export type BuilderToHost =
  | { type: 'ready' }
  | { type: 'fetchDims'; cube: string }
  | { type: 'fetchElements'; dim: string; query: string; skip: number }
  | { type: 'confirm'; text: string }
  | { type: 'cancel' };
