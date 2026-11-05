/**
 * TI parser package API. Callers outside this directory take these names from here, not
 * from the sub-module that defines them.
 *
 * Module responsibilities:
 * - tiParser/error.ts          — ParseError class
 * - tiParser/helpers.ts        — splitParams, splitStatementsAtDepthZero, hasTrailingEndif,
 *                                detectCellGet, extractCondition, stripRedundantLineRef
 * - tiParser/continuations.ts  — joinContinuationLines, unfoldMultiStatementLines
 * - tiParser/statements.ts     — tryParseAssignment, tryParseFunctionCall,
 *                                tryParseSingleLineIf, tryParseBareKeyword, BARE_KEYWORDS
 * - tiParser/blocks.ts         — parseBlock, parseIfBlock, parseWhileBlock
 * - tiParser/parse.ts          — parseTiCode, parseTiCodeAccumulating
 */

export { parseTiCode, parseTiCodeAccumulating } from './parse';
export { joinContinuationLines } from './continuations';
