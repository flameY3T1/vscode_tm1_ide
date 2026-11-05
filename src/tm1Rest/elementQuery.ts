/**
 * Pure query-string builder for the Dimension Browser element fetch.
 * No `vscode` import — unit-testable.
 *
 * Until 2026-08-25, there was a second pair here: `buildElementFilter` (OData
 * `$filter`) and `buildElementMdxSet` (MDX set). Both had had NO caller left
 * since the old loading path was dismantled — the page fetch builds its MDX
 * in `webviewClient/dimensionBrowser/viewMdx.ts`, from the filter bar's
 * expression stack. A comment here even still claimed the opposite ("runs
 * consistently through `buildElementMdxSet`"), which was true at the time of
 * writing and silently became wrong afterward.
 *
 * REST form verified live 2026-06-14 (see spec).
 */

import { escapeODataKey } from '../utils/odataKey';

/** OData string-literal escape: ' → ''. */
function escOData(s: string): string { return escapeODataKey(s); }

/**
 * OData `$filter` blocks for an explicit name list (`Name eq 'A' or Name eq 'B'`).
 *
 * Chunked because a view axis or subset can hold thousands of names and TM1
 * answers an over-long URL with a plain 400. Verified live on 11.8: 12 names
 * plus `$expand=Parents` = 721 URL chars, 253 ms.
 */
export function buildNameFilters(names: readonly string[], chunkSize = 40): string[] {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const n of names) {
    if (!n || seen.has(n)) { continue; }
    seen.add(n);
    clean.push(n);
  }
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += chunkSize) {
    out.push(clean.slice(i, i + chunkSize).map((n) => `Name eq '${escOData(n)}'`).join(' or '));
  }
  return out;
}
