// Pure, DOM-free helpers for the TI Consistency Normalizer webview.
//
// Kept out of index.ts (which needs `document`/`acquireVsCodeApi`) so the
// critical target-resolution logic gets real regression coverage even
// though this repo's vitest config has no jsdom/happy-dom environment
// (see vitest.config.ts — default 'node', no DOM globals; same reasoning
// as the `// No jsdom in this repo` comments in dimBrowser*.test.ts).

/** Minimal shape `resolveTarget` needs — structurally satisfied by the
 *  webview's `Group` type (see index.ts) without importing it (would
 *  pull `document`/vscode typings into this DOM-free module). */
export interface TargetGroup {
  key: string;
  editableTarget: boolean;
  targetSuggestion: string;
}

/**
 * Resolves the canonical rewrite target for a group.
 *
 * - Editable rules (var-casing, naming-convention) let the user override the
 *   suggested target via an `<input class="target">`; `inputValue` is that
 *   field's current value. Empty/undefined falls back to `targetSuggestion`.
 * - Non-editable rules (function-casing, keyword-casing) have no input —
 *   the target is ALWAYS the canonical `targetSuggestion` (e.g. "CellPutN",
 *   "IF"), regardless of any `inputValue` passed in.
 *
 * Must NEVER return `group.key`: the key is the lowercase grouping spelling
 * used for matching variants, not a valid rewrite target. Falling back to it
 * was the Critical review bug — applying Function/Keyword Casing rewrote
 * e.g. `CellPutN` down to `cellputn` and `IF`/`End` down to `if`/`end`, the
 * exact opposite of the rule's intent.
 */
export function resolveTarget(g: TargetGroup, inputValue?: string): string {
  if (g.editableTarget) {
    return inputValue !== undefined && inputValue.trim() !== '' ? inputValue : g.targetSuggestion;
  }
  return g.targetSuggestion;
}
