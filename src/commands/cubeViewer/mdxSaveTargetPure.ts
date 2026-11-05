import type { WebviewToHost } from '../../webviewClient/cubeViewerMonaco/protocol';

type SaveMdxViewMsg = Extract<WebviewToHost, { type: 'saveMdxView' }>;

export interface MdxSaveTarget {
  viewName: string; isPrivate: boolean; overwrite: boolean; mdx: string;
}

/** Derives the save target from the save message. null if viewName is empty. */
export function resolveMdxSaveTarget(msg: SaveMdxViewMsg): MdxSaveTarget | null {
  const viewName = msg.viewName.trim();
  if (!viewName) { return null; }
  return { viewName, isPrivate: msg.isPrivate, overwrite: msg.overwrite, mdx: msg.mdx };
}
