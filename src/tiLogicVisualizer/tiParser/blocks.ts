/**
 * Block parsers: parseBlock, parseIfBlock, parseWhileBlock.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

import { TiIfBlock, TiParseError, TiStatement, TiWhileBlock } from '../types';
import { ParseError } from './error';
import { extractCondition, hasTrailingEndif, splitParams } from './helpers';
import {
  BARE_KEYWORDS,
  tryParseAssignment,
  tryParseBareKeyword,
  tryParseFunctionCall,
  tryParseSingleLineIf,
} from './statements';

export {};

export interface ParseBlockResult {
  statements: TiStatement[];
  nextIndex: number;
  /**
   * Meaningful only in the lenient run: `false` if the block stayed open at the
   * end of the text. The caller then knows that the missing terminator has
   * already been reported and must not report it a second time.
   */
  closed: boolean;
}

/**
 * Collection point for the lenient run. If it is set, the parser no longer
 * THROWS: it writes the error into it and continues at the next line —
 * in the SAME block. That is exactly what the block loss hinged on: the
 * resumer that used to sit outside could not continue a started block,
 * because an `IF` without `ENDIF` is not parseable on its own.
 *
 * Without a collection point everything stays as before — `parseTiCode` throws
 * at the first error, and callers depend on exactly that.
 */
export type ErrorSink = TiParseError[] | undefined;

/**
 * Reports an error: write it into the collection point if there is one, throw if not.
 *
 * The return value tells the caller whether it may continue — it is always
 * `true` if the function returns at all, and makes the intent at the
 * call site readable (`if (report(...)) { i++; continue; }`).
 */
function report(sink: ErrorSink, line: number, messageKey: string, messageArgs: (string | number)[] = []): boolean {
  if (!sink) { throw new ParseError(line, messageKey, messageArgs); }
  sink.push({ line, message: messageKey, messageKey, messageArgs });
  return true;
}

export interface IfParseResult {
  ifBlock: TiIfBlock;
  nextIndex: number;
}

export interface WhileParseResult {
  whileBlock: TiWhileBlock;
  nextIndex: number;
}

export function parseBlock(
  lines: string[],
  lineNums: number[],
  startIndex: number,
  terminator: 'endif' | 'end' | null,
  sink: ErrorSink = undefined,
): ParseBlockResult {
  const statements: TiStatement[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }

    const upper = trimmed.toUpperCase();
    const lineNum = lineNums[i] ?? i + 1;

    if (trimmed.includes(';;')) {
      report(sink, lineNum, 'Duplicate semicolon: each statement needs exactly one semicolon');
      i++;
      continue;
    }

    if (/^ENDIF\s*;?\s*$/.test(upper)) {
      if (terminator === 'endif') {
        return { statements, nextIndex: i, closed: true };
      }
      report(sink, lineNum, 'Unexpected ENDIF without a matching IF');
      i++;
      continue;
    }

    if (/^END\s*;?\s*$/.test(upper)) {
      if (terminator === 'end') {
        return { statements, nextIndex: i, closed: true };
      }
      report(sink, lineNum, 'Unexpected END without a matching WHILE');
      i++;
      continue;
    }

    if (upper.startsWith('ELSEIF') || /^ELSE\s*;?\s*$/.test(upper)) {
      if (terminator === 'endif') {
        return { statements, nextIndex: i, closed: true };
      }
      report(sink, lineNum, 'Unexpected {0} without a matching IF', [upper.startsWith('ELSEIF') ? 'ELSEIF' : 'ELSE']);
      i++;
      continue;
    }

    if (upper.startsWith('IF') && /^IF\s*\(/i.test(trimmed) && hasTrailingEndif(trimmed)) {
      const inlineIf = tryParseSingleLineIf(trimmed, lineNum);
      if (inlineIf) {
        statements.push(inlineIf);
        i++;
        continue;
      }
    }

    if (upper.startsWith('IF') && /^IF\s*\(/i.test(trimmed)) {
      // TI has two `IF` forms with identical lexical prefix:
      //   • Control-flow block: `IF(cond);` ... `ENDIF;` (1-arg, no trailing ENDIF on the same line)
      //   • Builtin ternary expression: `IF(cond, true_value, false_value)` (3 args, value-returning)
      // The 3-arg expression form is sometimes used as a top-level statement
      // when the return value is discarded (e.g. `IF(v@='',ItemSkip,0);`).
      // Distinguish by arg-count at outer paren depth — 3 args = expression,
      // not a block opener.
      const ternary = tryParseIfTernaryCall(trimmed, lineNum);
      if (ternary) {
        statements.push(ternary);
        i++;
        continue;
      }
      const result = parseIfBlock(lines, lineNums, i, sink);
      statements.push(result.ifBlock);
      i = result.nextIndex;
      continue;
    }

    if (upper.startsWith('WHILE') && /^WHILE\s*\(/i.test(trimmed)) {
      const result = parseWhileBlock(lines, lineNums, i, sink);
      statements.push(result.whileBlock);
      i = result.nextIndex;
      continue;
    }

    if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*\s*=\s*;$/.test(trimmed)) {
      const varName = trimmed.split(/\s*=/)[0].trim();
      report(sink, lineNum, `Empty assignment: "{0}" has no value (e.g. {1} = 1; or {2} = 'text';)`, [varName, varName, varName]);
      i++;
      continue;
    }
    if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*\s*=\s*.+$/.test(trimmed) && !trimmed.endsWith(';')) {
      const upperFirst = trimmed.split(/[\s=(]/)[0].toUpperCase();
      if (!['IF', 'ELSEIF', 'ELSE', 'ENDIF', 'WHILE', 'END'].includes(upperFirst)) {
        report(sink, lineNum, 'Missing semicolon at end of line');
        i++;
        continue;
      }
    }
    const assignment = tryParseAssignment(trimmed, lineNum);
    if (assignment) {
      statements.push(assignment);
      i++;
      continue;
    }

    if (/^[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*\s*\(/.test(trimmed) && !trimmed.endsWith(';')) {
      const upperFirst = trimmed.split(/[\s(]/)[0].toUpperCase();
      if (!['IF', 'ELSEIF', 'WHILE'].includes(upperFirst)) {
        report(sink, lineNum, 'Missing semicolon at end of line');
        i++;
        continue;
      }
    }
    const funcCall = tryParseFunctionCall(trimmed, lineNum);
    if (funcCall) {
      statements.push(funcCall);
      i++;
      continue;
    }

    const cleanedForBareCheck = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed.trim();
    if (BARE_KEYWORDS.has(cleanedForBareCheck.toLowerCase()) && !trimmed.endsWith(';')) {
      report(sink, lineNum, 'Missing semicolon at end of line');
      i++;
      continue;
    }
    const bareKeyword = tryParseBareKeyword(trimmed, lineNum);
    if (bareKeyword) {
      statements.push(bareKeyword);
      i++;
      continue;
    }

    report(sink, lineNum, 'Unknown statement: "{0}" — expected an assignment (var = expr;), a function call (Fn(...);), or a keyword', [trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed]);
    i++;
  }

  if (terminator === 'endif') {
    report(sink, lineNums[lines.length - 1] ?? lines.length, 'Missing ENDIF — IF block was not closed');
    return { statements, nextIndex: i, closed: false };
  }
  if (terminator === 'end') {
    report(sink, lineNums[lines.length - 1] ?? lines.length, 'Missing END — WHILE block was not closed');
    return { statements, nextIndex: i, closed: false };
  }

  return { statements, nextIndex: i, closed: true };
}

/**
 * Detects the TI builtin ternary form `IF(cond, true_value, false_value)`
 * used as a top-level expression-statement. Returns a `TiFunctionCall` so
 * the linter treats it like any other builtin call instead of a malformed
 * block opener.
 *
 * Returns `null` when the line is the control-flow form `IF(cond);` (1 arg
 * before the closing paren) — that caller falls back to the multi-line
 * `parseIfBlock`.
 */
function tryParseIfTernaryCall(line: string, lineNum: number): TiStatement | null {
  const m = line.match(/^IF\s*\(/i);
  if (!m) { return null; }
  const argsStart = m[0].length;
  let depth = 1;
  let inStr = false;
  let argsEnd = -1;
  for (let j = argsStart; j < line.length; j++) {
    const ch = line[j];
    if (ch === "'") { inStr = !inStr; continue; }
    if (inStr) { continue; }
    if (ch === '(') { depth++; }
    else if (ch === ')') {
      depth--;
      if (depth === 0) { argsEnd = j; break; }
    }
  }
  if (argsEnd === -1) { return null; }
  const after = line.substring(argsEnd + 1).trim();
  // Block-opener form: `IF(cond);` — trailing semicolon, nothing else.
  // Expression form must end the same way; both bodies are `;`- or empty-
  // terminated. The distinguishing feature is arg-count.
  if (after !== '' && after !== ';') { return null; }
  const argsStr = line.substring(argsStart, argsEnd);
  const args = argsStr.trim() ? splitParams(argsStr) : [];
  if (args.length !== 3) { return null; }
  return { type: 'functionCall', name: 'IF', args, line: lineNum };
}

export function parseIfBlock(lines: string[], lineNums: number[], startIndex: number, sink: ErrorSink = undefined): IfParseResult {
  const trimmed = lines[startIndex].trim();
  const lineNum = lineNums[startIndex] ?? startIndex + 1;
  const condition = extractCondition(trimmed, 'IF');

  const thenResult = parseBlock(lines, lineNums, startIndex + 1, 'endif', sink);
  const thenBody = thenResult.statements;
  let i = thenResult.nextIndex;
  // The body has reached the end of the text and has already reported the missing
  // terminator. A second entry at the end of this function would be the same
  // error a second time.
  let reported = !thenResult.closed;

  const elseIfClauses: Array<{ condition: string; body: TiStatement[]; line: number }> = [];
  let elseBody: TiStatement[] = [];

  while (i < lines.length) {
    const currentTrimmed = lines[i].trim();
    const currentUpper = currentTrimmed.toUpperCase();

    if (/^ENDIF\s*;?\s*$/.test(currentUpper)) {
      return {
        ifBlock: { type: 'if', condition, thenBody, elseIfClauses, elseBody, line: lineNum },
        nextIndex: i + 1,
      };
    }

    if (currentUpper.startsWith('ELSEIF') && /^ELSEIF\s*\(/i.test(currentTrimmed)) {
      const elseIfCondition = extractCondition(currentTrimmed, 'ELSEIF');
      const elseIfLine = lineNums[i] ?? i + 1;
      const elseIfResult = parseBlock(lines, lineNums, i + 1, 'endif', sink);
      elseIfClauses.push({ condition: elseIfCondition, body: elseIfResult.statements, line: elseIfLine });
      i = elseIfResult.nextIndex;
      reported = reported || !elseIfResult.closed;
      continue;
    }

    if (/^ELSE\s*;?\s*$/.test(currentUpper)) {
      const elseResult = parseBlock(lines, lineNums, i + 1, 'endif', sink);
      elseBody = elseResult.statements;
      i = elseResult.nextIndex;
      reported = reported || !elseResult.closed;
      continue;
    }

    break;
  }

  if (!reported) {
    report(sink, lineNums[lines.length - 1] ?? lines.length, 'Missing ENDIF — IF block was not closed');
  }
  // Lenient run: return the block with what was read. The
  // nesting is thereby preserved even if the ENDIF is missing.
  return {
    ifBlock: { type: 'if', condition, thenBody, elseIfClauses, elseBody, line: lineNum },
    nextIndex: i,
  };
}

export function parseWhileBlock(lines: string[], lineNums: number[], startIndex: number, sink: ErrorSink = undefined): WhileParseResult {
  const trimmed = lines[startIndex].trim();
  const lineNum = lineNums[startIndex] ?? startIndex + 1;
  const condition = extractCondition(trimmed, 'WHILE');

  const bodyResult = parseBlock(lines, lineNums, startIndex + 1, 'end', sink);

  return {
    whileBlock: {
      type: 'while',
      condition,
      body: bodyResult.statements,
      line: lineNum,
    },
    // With a closed block `nextIndex` points at the END, which is skipped.
    // Without a terminator it is already at the end of the text — then do not count on,
    // otherwise the outer block runs past the end.
    nextIndex: bodyResult.closed ? bodyResult.nextIndex + 1 : bodyResult.nextIndex,
  };
}
