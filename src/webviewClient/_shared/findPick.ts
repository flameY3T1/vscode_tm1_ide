// src/webviewClient/_shared/findPick.ts
//
// Which hit is steered to after a search — pure, without DOM and without
// Monaco, so that the rule stays testable without an editor.
//
// The find bar searches across N sources (the process editor: Prolog, Metadata,
// Data, Epilog) and collects the hits in source order. "Hit 0" therefore means
// "first hit of the FIRST source" — and not "the hit the user is interested
// in". That is exactly where typing went off the rails: the editor jumped to a
// different tab at the first letter.

export interface FindMatchRef {
  sourceKey: string;
  lineNumber: number;
  column: number;
  length: number;
}

/** Index of the first hit in `key`, or -1. */
export function firstMatchIdxInSource(matches: readonly FindMatchRef[], key: string | null): number {
  if (!key) { return -1; }
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].sourceKey === key) { return i; }
  }
  return -1;
}

/**
 * The hit that a fresh search points to.
 *
 * The active tab takes precedence: whoever is in `Data` and types wants to
 * land there, not in `Prolog`. Only when the active tab yields nothing is the
 * first hit overall the right answer — a jump to another tab is then no
 * surprise, but the only place where it was found.
 */
export function pickInitialMatchIdx(matches: readonly FindMatchRef[], activeKey: string | null): number {
  if (matches.length === 0) { return -1; }
  const inActive = firstMatchIdxInSource(matches, activeKey);
  return inActive >= 0 ? inActive : 0;
}

/**
 * The hit that begins EXACTLY at this position, or -1.
 *
 * Needed when opening the bar over a selection (double-click on a word, then
 * Ctrl+F): the selected word is itself one of the hits, and the bar should stay
 * on it instead of yanking the editor somewhere else.
 */
export function matchIdxAtSelection(
  matches: readonly FindMatchRef[],
  key: string | null,
  lineNumber: number,
  column: number,
): number {
  if (!key) { return -1; }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.sourceKey === key && m.lineNumber === lineNumber && m.column === column) { return i; }
  }
  return -1;
}
