/**
 * Marker for an MDX-BACKED object — a dynamic subset, whose members come from an
 * MDX expression instead of a stored element list, and an MDX view, whose grid
 * comes from an expression instead of stored axes.
 *
 * `{}` instead of the former `ƒx` (click test flameY3T1, 2026-08-12): `ƒx` read as
 * "formula" and so captured only half the meaning — what is marked here is
 * always an MDX expression, and its hallmark is the curly
 * braces of a set. The same mark is therefore now also used on the view dropdown of the
 * Cube Viewer, where the same distinction arises. It is a SYMBOL, not
 * translatable text — only the words around it belong in the l10n bundle.
 *
 * Single source of truth for the surfaces that mark this, so they do
 * not drift apart:
 * - Subset-Dropdown im Dimension Browser
 *   (`webviewClient/dimensionBrowser/subset.ts#subsetOptionLabel`)
 * - View-Dropdown im Cube Viewer
 *   (`webviewClient/cubeViewerMonaco/viewPickerPure.ts#viewOptionLabel`)
 * - TM1-Explorer-Baum (`providers/tm1TreeNodes.ts`)
 *
 * vscode-free by design: the webview bundle imports it too.
 */
export const DYNAMIC_SUBSET_MARK = '{}';
