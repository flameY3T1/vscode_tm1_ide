// src/webviewClient/_shared/findSnippet.ts
// Pure snippet builder for in-editor find result rows. Shared by the process
// editor's cross-section find and the rule editor's find overlay (both via
// `_shared/findOverlay`). No DOM / editor dependencies — unit-tested in
// `test/webviews/processEditor/findResultsPure.test.ts`.

export interface SnippetParts {
  before: string;
  match: string;
  after: string;
  truncatedLeft: boolean;
  truncatedRight: boolean;
}

/**
 * Split a source line into `{before, match, after}` around a match so the caller
 * can render the matched substring in bold via textContent (no HTML escaping
 * needed). Leading indentation is dropped and over-long context is clipped from
 * both sides so the match stays visible inside a narrow results row.
 *
 * @param lineText  full line content
 * @param column    1-based start column of the match (Monaco convention)
 * @param length    match length in characters
 * @param maxBefore max chars of context kept left of the match (default 40)
 * @param maxAfter  max chars of context kept right of the match (default 80)
 */
export function buildSnippet(
  lineText: string,
  column: number,
  length: number,
  maxBefore = 40,
  maxAfter = 80,
): SnippetParts {
  const start = Math.max(0, column - 1);
  const len = Math.max(0, length);
  const match = lineText.substr(start, len);

  let before = lineText.slice(0, start).replace(/^\s+/, '');
  let truncatedLeft = false;
  if (before.length > maxBefore) {
    before = before.slice(before.length - maxBefore);
    truncatedLeft = true;
  }

  let after = lineText.slice(start + len);
  let truncatedRight = false;
  if (after.length > maxAfter) {
    after = after.slice(0, maxAfter);
    truncatedRight = true;
  }

  return { before, match, after, truncatedLeft, truncatedRight };
}
