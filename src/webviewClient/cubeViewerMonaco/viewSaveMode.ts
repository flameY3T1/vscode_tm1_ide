// src/webviewClient/cubeViewerMonaco/viewSaveMode.ts
//
// The save mode of the view dialog — pure, without DOM, so that the rule stays
// testable.
//
// Until 2026-08-04 there was no choice: the dialog decided silently based on
// `isMdxView`. Deliberately storing a view as an MDX view was therefore
// impossible, even though the save path (`saveMdxView`) had long existed.

export interface ViewSaveOrigin {
  /** Name of the loaded view, or `null` (freshly opened / pivoted). */
  existingViewName: string | null;
  /** Is the loaded view an MDX view? */
  isMdxView: boolean;
  /** MDX from the MDX window, if the dialog was opened from there. */
  pendingMdx: string | null;
}

/**
 * Whether "save as MDX" is PRE-CHECKED.
 *
 * On in every case — unless a real native view is loaded. Anyone who opens a
 * native view and writes it back does not want to turn it into an MDX view on
 * the side; everything else (freshly opened cube, self-pivoted axes, loaded MDX
 * view, MDX window) is not a native original anyway.
 *
 * That pivoted axes arrive here as "no loaded view" is no coincidence:
 * `axis.ts` releases the binding when pivoting (`existingViewName = null`),
 * because the view is then no longer the saved one.
 *
 * Only a default — unchecking remains possible at any time.
 */
export function mdxSaveDefaultOn(origin: ViewSaveOrigin): boolean {
  if (origin.pendingMdx !== null) { return true; }
  const nativeViewLoaded = !!origin.existingViewName && !origin.isMdxView;
  return !nativeViewLoaded;
}
