/**
 * Top-level parser entries.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

import { TiAst, TiParseError, TiParseResult } from '../types';
import { ParseError } from './error';
import { joinContinuationLines, unfoldMultiStatementLines } from './continuations';
import { parseBlock } from './blocks';

export {};

export function parseTiCode(code: string): TiParseResult {
  const rawLines = code.split('\n');
  const joined = joinContinuationLines(rawLines);
  const { lines, lineNums } = unfoldMultiStatementLines(joined);
  try {
    const { statements } = parseBlock(lines, lineNums, 0, null);
    return { ok: true, ast: statements };
  } catch (e) {
    if (e instanceof ParseError) {
      return { ok: false, error: { line: e.line, message: e.messageKey, messageKey: e.messageKey, messageArgs: e.messageArgs } };
    }
    throw e;
  }
}

/**
 * Lenient run: reads the WHOLE text in one pass and collects the
 * errors, instead of restarting on a slice behind every error.
 *
 * Until 2026-09-01 it ran the other way round, and that cost more than the
 * error itself. The resumer parsed the lead-in up to the error line on its own;
 * if the error was inside a block, this lead-in was an `IF` without `ENDIF`
 * and therefore not parseable — the whole lead-in was thrown away, along with
 * statements BEFORE the block. Measured on
 *
 *     nA = 1;  IF(nA=1);  nB = 2;  nKaputt = ;  nC = 3;  ENDIF;  nD = 4;
 *
 * exactly `nC` and `nD` remained, both at top level, plus an
 * INVENTED second error "Unexpected ENDIF without a matching IF" on the
 * error-free ENDIF line.
 *
 * That hit every rule that relies on nesting — `endless-loop`,
 * `performance-hint`, `cellget-in-loop-constant`, `dead-code-condition`,
 * `empty-if`/`-while`, `unused-variable`/`dead-store`: behind the first
 * parse error of a section they silently judged wrongly, in both
 * directions.
 *
 * The leniency now sits where the nesting is known: `parseBlock`
 * writes the error into the collection point and continues at the next line in the
 * SAME block. That also removes the line shifting
 * (`shiftStatementLines`) — the whole text is read only once,
 * the line numbers are right by themselves.
 *
 * `parseTiCode` stays strict and throws at the first error; callers depend on
 * exactly that.
 */
export function parseTiCodeAccumulating(code: string): { ast: TiAst; errors: TiParseError[] } {
  const rawLines = code.split('\n');
  const joined = joinContinuationLines(rawLines);
  const { lines, lineNums } = unfoldMultiStatementLines(joined);
  // The collection point switches `parseBlock` from throwing to reporting. The
  // English keys carry no line information, so `message`
  // equals `messageKey` — callers check for it (`.includes('semicolon')`).
  const errors: TiParseError[] = [];
  const { statements } = parseBlock(lines, lineNums, 0, null, errors);
  return { ast: statements, errors };
}
