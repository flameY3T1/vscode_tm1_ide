// src/webviewClient/lineage/protocol.ts
// Messages between the lineage window and the host (`references/lineage.ts`).
import type { CubeFlowEdge, DependencyGraph, MapNode } from '../../references/lineagePure';

export type CubeFlowGraph = { nodes: MapNode[]; edges: CubeFlowEdge[] };

export type WebviewToHost =
  | { type: 'mapReady' }
  | { type: 'mapRefresh' }
  | { type: 'mapOpen'; id: string; name: string }
  | { type: 'lineageServer'; id: string | null }
  | { type: 'mapBack' };

export type HostToWebview =
  | { type: 'mapData'; graph?: DependencyGraph; cubeGraph?: CubeFlowGraph }
  | { type: 'mapError'; message: string }
  | { type: 'lineageHighlight'; id: string };

/** Texts of the page, built by the host with vscode.l10n. */
export interface LineageTexts {
  title: string; dependencies: string; dataFlow: string; overview: string; depNeedsFocus: string;
  hintOverview: string; sources: string; srcOff: string; srcSys: string; srcDetail: string;
  srcSysTip: string; srcDetailTip: string; sourcesTip: string; noFlowAtAll: string;
  viaProcess: string; viaRule: string; via: string; rule: string; hintCube: string; noCubeFlow: string;
  refresh: string; loading: string; chores: string; processes: string; cubes: string;
  dimensions: string; calls: string; reads: string; writes: string; hint: string; empty: string;
}

/** `window.__lineage`: texts and the start state from the host. */
export interface LineageBootstrap {
  texts: LineageTexts;
  /** Node id to center on; null = the server's own panel. */
  initialFocus: string | null;
  initialName: string;
  /** True inside an object's tab (there is a back tab). */
  inTab: boolean;
  /** Overview only: object to mark on first draw. */
  highlightId: string | null;
}
