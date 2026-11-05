/**
 * Facade of the new view path, split along the window phases.
 *
 * Importers and tests keep their `./viewPath` imports; the code lives in:
 *   viewStart   - opening: start/switch the view, bind table and trail clicks
 *   viewActions - intents that replace the base or push onto the stack
 *   viewLayers  - layers from the marking or a filter (keep, remove, filter, preview)
 *   viewOrder   - manual-order edits (append, pick parent, insert, move)
 *   viewAnswer  - redeeming host responses (viewRows, viewCount, levels, attrDefs)
 *   viewQuery   - read-only questions about the running view
 * Shared run state stays in `viewRun.ts` (`vr`).
 */

export { currentRows, rowsComplete, postFromView, currentTotal, viewIsPristine, dimOfView, hierOfView, currentAlias, viewOfDiag, clipboardNames, currentMdx } from './viewQuery';
export { removeMarked, cutMarked,} from './viewLayers';
export { resetView, setBase, applyCtxAction, setLevel, setMdxBase, setToLevelBase, setAlias } from './viewActions';
export { addNames, pickParentAt, insertNamesAt, setNamesBase } from './viewOrder';
export { _resetViewPathForTest, switchHierarchy, drawView, repaintMarks, startView } from './viewStart';
export { onViewCount, onLevels, onAttrDefs, onViewRows } from './viewAnswer';
export { _rowHForTest, _measureRowHForTest } from './viewViewport';
export { paintMarkCount } from './viewStats';
