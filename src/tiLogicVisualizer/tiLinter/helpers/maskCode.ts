/**
 * Length-bounded code masking for identifier scanning.
 *
 * Blanks out the regions where a token is NOT a referenceable TI identifier:
 * `'...'` string-literal interiors, `[...]` reference interiors (DB/element
 * refs), and `#...` comment tails. Shared by the canonical-name builder and the
 * inconsistent-casing finder so they exclude exactly the same regions the
 * formatter's `codeMask` excludes — keeping "what the linter flags" and "what the
 * formatter rewrites" structurally identical.
 */

import { maskedCopy, commentStart } from '../../formatRules';

/** Blank string/bracket interiors and drop the #-comment tail. Derived from the
 *  formatter's codeMask so the linter excludes EXACTLY what the formatter
 *  rewrites (lint == fix). */
export function maskLine(line: string): string {
  const masked = maskedCopy(line);
  const c = commentStart(line);
  return c >= 0 ? masked.slice(0, c) : masked;
}
