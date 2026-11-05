/**
 * Dimension Editor webview client — Bootstrap facade.
 *
 * Bundled by esbuild from `src/webviewClient/dimensionEditor/index.ts` →
 * `out/webview/dimensionEditor.js` and loaded by
 * `src/commands/dimension/dimensionEditorWebview.ts`.
 *
 * Post-H17 #4 split (2026-05-18): index.ts is pure bootstrap. Complete
 * logic lives in sub-modules.
 *
 * Module responsibilities:
 * - state.ts         — mutable namespace object + vscode handle
 * - pure.ts          — typeSortKey/compareByTypeName/escapeHtml/parseBulkInput/validateDimensionState
 * - modals.ts        — askInput, askConfirm, showError, showInfo, showToast
 * - helpers.ts       — elementsList, findElement, validateClient, updateDirty, escapeHtml
 * - tree.ts          — virtualized tree render + drawVisibleRows
 * - dragDrop.ts      — handleDrop (Reparenting + Zyklus-Check)
 * - detail.ts        — renderDetail, wireDetailHandlers, handleConfirmDelete
 * - attrModal.ts     — renderAttrModal
 * - bulkModal.ts     — parseBulkInput, updateBulkPreview, open/closeBulkModal, commitBulkAdd
 * - commit.ts        — serializeState, handleCommitResult, sendCommit, sendDiscard
 * - render.ts        — renderAll, enableLoadedControls, renderHierSelect
 * - hier.ts          — switchToHierLocal
 * - msg.ts           — initMsgHandler (postMessage-Router)
 * - dom.ts           — initDomHandlers (all DOM event listeners)
 */

import { vscode } from './state';
import { setTreeCallbacks } from './tree';
import { renderDetail } from './detail';
import { handleDrop, handleDropMany, handleMove, setDragDropRenderDetail } from './dragDrop';
import { promptAddElement } from './addElement';
import { pasteClipboard } from './pasteElements';
import { initMsgHandler } from './msg';
import { initDomHandlers } from './dom';

export {};

// Wire callbacks to break circular imports (tree/detail/dragDrop/addElement).
setTreeCallbacks({
  renderDetail, handleDrop, handleDropMany, handleMove,
  addElement: (parent) => { void promptAddElement(parent); }, pasteClipboard,
});
setDragDropRenderDetail(renderDetail);

initMsgHandler();
initDomHandlers();

vscode.postMessage({ type: 'ready' });
