/**
 * Pure (vscode-free) drag-source content builders for the TM1 tree.
 *
 * The vscode-coupled `tm1TreeDragDrop.ts` provides the TreeDragAndDropController
 * shell; the actual text-rendering logic lives here so it's unit-testable
 * without any vscode mock.
 */

/** Minimal shape of a draggable source — decoupled from Tm1TreeNode/vscode.TreeItem. */
export interface DragSource {
  nodeType: string;
  meta?: Record<string, unknown>;
  label?: string | { label: string } | undefined;
}

import { escapeODataKey } from '../utils/odataKey';

const DRAGGABLE_TYPES: ReadonlySet<string> = new Set(['process', 'chore', 'cube', 'dimension', 'hierarchy']);

/** OData / TI single-quote escape: `'` → `''`. */
export function escTi(s: string): string {
  return escapeODataKey(s);
}

export function isDraggable(s: DragSource): boolean {
  return DRAGGABLE_TYPES.has(s.nodeType);
}

function labelText(label: DragSource['label']): string {
  if (typeof label === 'string') { return label; }
  if (label && typeof label === 'object' && 'label' in label) { return label.label; }
  return '';
}

/**
 * Returns the drop-text for a draggable source.
 *   process → `ExecuteProcess('Name');`
 *   chore   → `ExecuteChore('Name');`
 *   cube    → `'CubeName'`     (single-quoted literal)
 *   dim     → `'DimensionName'`
 * Returns `''` for non-draggable types.
 */
export function buildDropText(s: DragSource): string {
  const meta = s.meta ?? {};
  const fallbackName = labelText(s.label);
  switch (s.nodeType) {
    case 'process': {
      const name = String(meta.processName ?? fallbackName);
      return `ExecuteProcess('${escTi(name)}');`;
    }
    case 'chore': {
      const name = String(meta.choreName ?? fallbackName);
      return `ExecuteChore('${escTi(name)}');`;
    }
    case 'cube': {
      const name = String(meta.cubeName ?? fallbackName);
      return `'${escTi(name)}'`;
    }
    case 'dimension': {
      const name = String(meta.dimName ?? fallbackName);
      return `'${escTi(name)}'`;
    }
    case 'hierarchy': {
      // A hierarchy references its dimension (TI/rules address via the dim name).
      const name = String(meta.dimName ?? fallbackName);
      return `'${escTi(name)}'`;
    }
    default:
      return '';
  }
}

/** Only name and type matter here: the value is the outer variable or a blank literal. */
export interface ProcessParamRef { Name: string; Type: string; }

/**
 * Builds `ExecuteProcess('Name', 'P1', value1, 'P2', value2);`, one
 * parameter pair per line so long parameter lists stay readable.
 *
 * With `outerParamNames` (params of the surrounding process):
 *   - case-insensitive match → variable reference (preserves outer casing)
 *   - no match               → numeric `0`, string `''`
 *
 * Without `outerParamNames`: numeric `0`, string `''` (no server defaults).
 */
export function buildExecuteProcessWithParams(
  processName: string,
  params: ProcessParamRef[],
  outerParamNames: string[] = [],
): string {
  const head = `'${escTi(processName)}'`;
  const outerByLower = new Map<string, string>();
  for (const n of outerParamNames) { outerByLower.set(n.toLowerCase(), n); }

  const args = params.map(p => {
    const isNum = (p.Type ?? '').toLowerCase() === 'numeric';
    const matched = outerByLower.get(p.Name.toLowerCase());
    if (matched) {
      return `'${escTi(p.Name)}', ${matched}`;
    }
    return isNum
      ? `'${escTi(p.Name)}', 0`
      : `'${escTi(p.Name)}', ''`;
  });
  if (args.length === 0) {
    return `ExecuteProcess(${head});`;
  }
  return `ExecuteProcess(${head},\n${args.map(a => `    ${a}`).join(',\n')}\n);`;
}
