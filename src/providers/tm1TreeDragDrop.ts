import * as vscode from 'vscode';
import { Tm1TreeNode } from './tm1TreeNodes';
import {
  isDraggable as _isDraggable,
  buildDropText as _buildDropText,
} from './tm1TreeDragDropPure';

// Re-export pure helpers so existing call-sites (registerTreeCommands) keep working.
export {
  buildDropText,
  buildExecuteProcessWithParams,
} from './tm1TreeDragDropPure';

/**
 * Drag source for TM1 tree nodes:
 *  - process   → ExecuteProcess('Name');
 *  - chore     → ExecuteChore('Name');
 *  - cube      → 'CubeName'      (String-Literal)
 *  - dimension → 'DimensionName' (String-Literal)
 *
 * Pure logic in tm1TreeDragDropPure.ts; this is the vscode-coupled shell.
 */
export class Tm1TreeDragDropController implements vscode.TreeDragAndDropController<Tm1TreeNode> {
  readonly dragMimeTypes = ['text/plain'];
  readonly dropMimeTypes: string[] = [];

  handleDrag(sources: readonly Tm1TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const node = sources.find(s => _isDraggable(s));
    if (!node) { return; }
    const text = _buildDropText(node);
    if (!text) { return; }
    dataTransfer.set('text/plain', new vscode.DataTransferItem(text));
  }
}
