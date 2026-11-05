import * as vscode from 'vscode';
import type { MdxResult } from './executeMdx';
import { MDX_CELL_LIMIT } from './executeMdx';
import { errMsg } from '../utils/errMsg';
import type {
  ValidateRef,
  InvalidRef,
  MdxInMessage,
  MdxOutMessage,
} from '../webviewClient/mdxRunnerMonaco/protocol';

// Re-exported for backward compatibility — single source of truth for these
// types is now `webviewClient/mdxRunnerMonaco/protocol.ts` (P3-2, Stufe 6b).
export type {
  MdxInMessage,
  MdxOutMessage,
};

export interface MdxHandlerDeps {
  execute:         (mdx: string) => Promise<MdxResult>;
  continueExecute: (cellsetId: string) => Promise<MdxResult>;
  abortCellset:    (cellsetId: string) => Promise<void>;
  readClipboard:   () => Promise<string>;
  writeClipboard:  (text: string) => Promise<void>;
  getCubes:        () => Promise<string[]>;
  getCubeDims:     (cube: string) => Promise<string[]>;
  getDimElements:  (dim: string, hier?: string) => Promise<Set<string> | null>;
  getElementNames: (dim: string, hier?: string) => Promise<string[]>;
}

function mdxResultToOut(result: MdxResult): MdxOutMessage {
  if (result.ok) {
    return { type: 'result', ok: true, table: result.table, elapsedMs: result.elapsedMs };
  }
  if (result.needsConfirm) {
    return { type: 'cellCountWarning', cellCount: result.cellCount, limit: MDX_CELL_LIMIT, cellsetId: result.cellsetId };
  }
  return { type: 'result', ok: false, error: result.error };
}

/** A rejected run (network error) still ends as a `result`, or the webview stays on "Running". */
async function runToOut(run: () => Promise<MdxResult>): Promise<MdxOutMessage> {
  try {
    return mdxResultToOut(await run());
  } catch (e) {
    return { type: 'result', ok: false, error: { code: 'client', message: errMsg(e) } };
  }
}

async function validate(
  cube: string | null,
  refs: ValidateRef[],
  getCubes: MdxHandlerDeps['getCubes'],
  getCubeDims: MdxHandlerDeps['getCubeDims'],
  getDimElements: MdxHandlerDeps['getDimElements'],
): Promise<InvalidRef[]> {
  // Offline probe. getCubes is cached with 5-min TTL so this is effectively
  // free on every validation. Empty list = server unreachable → no markers.
  const cubes = await getCubes();
  if (cubes.length === 0) { return []; }

  const invalid: InvalidRef[] = [];

  let cubeDimSet: Set<string> | null = null;
  if (cube) {
    const dims = await getCubeDims(cube);
    if (dims.length > 0) {
      cubeDimSet = new Set(dims.map(d => d.toLowerCase()));
    }
  }

  // Group by dimension AND hierarchy so each element list is loaded once — an
  // alternate hierarchy holds other elements than the default one.
  const byHier = new Map<string, ValidateRef[]>();
  for (const r of refs) {
    const key = `${r.dim}\u0000${r.hier ?? ''}`;
    const list = byHier.get(key) ?? [];
    list.push(r);
    byHier.set(key, list);
  }

  for (const list of byHier.values()) {
    const { dim, hier } = list[0];
    if (cubeDimSet && !cubeDimSet.has(dim.toLowerCase())) {
      for (const r of list) { invalid.push({ ...r, reason: 'dim-not-in-cube' }); }
      continue;
    }
    const elemSet = await getDimElements(dim, hier);
    // Unreadable (server error): no verdict, no markers.
    if (elemSet === null) { continue; }
    if (elemSet.size === 0) {
      // Named hierarchy with no elements: either it does not exist or it is
      // empty. Both are outside what an element check can tell apart, and a
      // wrong "dimension unknown" under a correct statement is worse than no
      // marker at all.
      if (hier !== undefined) { continue; }
      for (const r of list) { invalid.push({ ...r, reason: 'unknown-dimension' }); }
      continue;
    }
    for (const r of list) {
      if (!elemSet.has(leafName(r.element))) {
        invalid.push({ ...r, reason: 'unknown-element' });
      }
    }
  }
  return invalid;
}

/**
 * Element name out of TM1's path notation: `Total^Europe^Germany` addresses
 * `Germany` through its parents. The server's element list carries the leaf
 * name only, so everything up to the last `^` is the path, not the name.
 */
function leafName(element: string): string {
  const cut = element.lastIndexOf('^');
  return (cut === -1 ? element : element.slice(cut + 1)).toLowerCase();
}

/**
 * Pure message handler for the MDX runner webview — all vscode concerns
 * (panel, clipboard, apiRequest) are injected via `deps` for testability.
 * Returns the outgoing message to post back to the webview, or null when
 * no response is required (e.g. after a successful clipboard write).
 */
export async function handleMdxMessage(
  msg: MdxInMessage,
  deps: MdxHandlerDeps,
): Promise<MdxOutMessage | null> {
  if (msg.type === 'execute') {
    const mdx = (msg.mdx ?? '').trim();
    if (mdx === '') {
      return { type: 'result', ok: false, error: { code: 'client', message: vscode.l10n.t('The MDX query is empty.') } };
    }
    return runToOut(() => deps.execute(mdx));
  }

  if (msg.type === 'continueLoad') {
    return runToOut(() => deps.continueExecute(msg.cellsetId));
  }

  if (msg.type === 'abort') {
    try { await deps.abortCellset(msg.cellsetId); } catch { /* swallow — abort is best-effort */ }
    return null;
  }

  if (msg.type === 'requestPaste') {
    try { return { type: 'pasteText', text: await deps.readClipboard() }; }
    catch { return { type: 'pasteText', text: '' }; }
  }

  if (msg.type === 'requestCopy') {
    try { await deps.writeClipboard(msg.text ?? ''); } catch { /* clipboard write rejected (permission); webview cannot fall back, request is one-shot */ }
    return null;
  }

  if (msg.type === 'getCompletions') {
    let items: string[] = [];
    if (msg.context === 'cubes') {
      items = await deps.getCubes();
    } else if (msg.context === 'cubeDims' && msg.cube) {
      items = await deps.getCubeDims(msg.cube);
    } else if (msg.context === 'dimElements' && msg.dim) {
      items = await deps.getElementNames(msg.dim, msg.hier);
    }
    return { type: 'completions', context: msg.context, reqId: msg.reqId, items };
  }

  if (msg.type === 'validateNames') {
    const invalid = await validate(msg.cube, msg.refs, deps.getCubes, deps.getCubeDims, deps.getDimElements);
    return { type: 'validationResult', version: msg.version, invalid };
  }

  return null;
}
