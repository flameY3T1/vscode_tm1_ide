// Pure, vscode-free helpers for detecting and toggling the per-axis
// `NON EMPTY` modifier in an MDX SELECT. Shared by the cube viewer's extension
// side (fetch.ts, parsing a saved MDXView) and its webview client (syncing the
// "0 rows" / "0 columns" suppress buttons with inline MDX, and rewriting the
// MDX when a button is toggled).
//
// The SELECT is dissected by the shared parser in `selectAxesPure` — bracket-
// and string-aware, so nested sets, sub-selects (`FROM (SELECT … )`) and string
// literals don't trip it up.

import { axisOf, parseSelect } from './selectAxesPure';

export interface NonEmptyAxes {
  rows: boolean;
  cols: boolean;
}

function _hasNonEmpty(segment: string): boolean {
  return /^\s*NON\s+EMPTY\b/i.test(segment);
}

/** Detect whether the rows / columns axes carry `NON EMPTY`. */
export function detectNonEmptyAxes(mdx: string): NonEmptyAxes {
  const res: NonEmptyAxes = { rows: false, cols: false };
  const parsed = parseSelect(mdx);
  if (!parsed) { return res; }
  for (const seg of parsed.segments) {
    const axis = axisOf(seg)?.kind;
    if (axis && _hasNonEmpty(seg)) { res[axis] = true; }
  }
  return res;
}

/**
 * Add (`on=true`) or remove (`on=false`) the `NON EMPTY` modifier on the given
 * axis of an MDX SELECT, preserving the rest of the text verbatim. Returns the
 * input unchanged if the axis isn't present or already in the desired state.
 */
export function setNonEmptyAxis(mdx: string, axis: 'rows' | 'cols', on: boolean): string {
  const parsed = parseSelect(mdx);
  if (!parsed) { return mdx; }
  let changed = false;
  const segments = parsed.segments.map((seg) => {
    if (axisOf(seg)?.kind !== axis) { return seg; }
    const has = _hasNonEmpty(seg);
    if (on && !has) { changed = true; return seg.replace(/^(\s*)/, '$1NON EMPTY '); }
    if (!on && has) { changed = true; return seg.replace(/^(\s*)NON\s+EMPTY\s+/i, '$1'); }
    return seg;
  });
  if (!changed) { return mdx; }
  return parsed.pre + segments.join(',') + parsed.post;
}
