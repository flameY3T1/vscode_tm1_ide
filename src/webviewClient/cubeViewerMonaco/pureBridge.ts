/**
 * Re-export of pure-logic modules from `src/cubeViewer/` for webview consumption.
 *
 * These were previously duplicated as JS mirrors inside the inline-template
 * webview script. With the bundle in place we can import the real TS source
 * — single source of truth, and the unit tests in src/test/cubeViewer/ now
 * cover what the webview actually runs.
 *
 * Signatures match the former mirrors 1:1 — no adapters required.
 */

export { buildCoordinates, cellTarget, coordinateKeys, namesDimTwice, parseEditedValue, parseStringCellValue, normalizeDecimal } from '../../cubeViewer/cellWrite';

export { parseSpreadToken } from '../../cubeViewer/spreadTokenParser';

export type { SpreadMethod } from '../../cubeViewer/spreadMethods';

export { pickDefinitionForCell } from '../../cubeViewer/picklistPure';

import { createUndoStack } from '../../cubeViewer/undoStack';

/** Webview-global undo stack singleton (cap 20, matches former _undoStack). */
export const undoStack = createUndoStack(20);
