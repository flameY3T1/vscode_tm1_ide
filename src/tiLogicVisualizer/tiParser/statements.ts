/**
 * Single-line statement parsers + BARE_KEYWORDS set.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

import { TiAssignment, TiFunctionCall, TiIfBlock, TiStatement } from '../types';
import { KNOWN_SIGNATURES } from '../tiSignatures';
import { detectCellGet, splitParams, splitStatementsAtDepthZero } from './helpers';

export {};

export function tryParseAssignment(line: string, lineNum: number): TiAssignment | null {
  const match = line.match(/^([A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*)\s*=\s*(.+?)\s*;?\s*$/);
  if (!match) return null;

  const variable = match[1];
  const expression = match[2].trim();

  const upperVar = variable.toUpperCase();
  if (['IF', 'ELSEIF', 'ELSE', 'ENDIF', 'WHILE', 'END'].includes(upperVar)) {
    return null;
  }

  const cellGetInfo = detectCellGet(expression);

  return {
    type: 'assignment',
    variable,
    expression,
    isExternal: cellGetInfo !== undefined,
    cellGetInfo,
    line: lineNum,
  };
}

export function tryParseFunctionCall(line: string, lineNum: number): TiFunctionCall | null {
  const nameMatch = line.match(/^([A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*)\s*\(/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const upperName = name.toUpperCase();
  if (['IF', 'ELSEIF', 'WHILE'].includes(upperName)) {
    return null;
  }

  const argsStart = nameMatch[0].length;
  let depth = 1;
  let argsEnd = -1;
  let inString = false;
  let stringChar = '';
  for (let j = argsStart; j < line.length; j++) {
    const ch = line[j];
    if (inString) {
      if (ch === stringChar) { inString = false; }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) {
        argsEnd = j;
        break;
      }
    }
  }

  if (argsEnd === -1) return null;

  const remainder = line.substring(argsEnd + 1).trim();
  if (remainder !== '' && remainder !== ';') return null;

  const argsStr = line.substring(argsStart, argsEnd).trim();
  const args = argsStr ? splitParams(argsStr) : [];

  return {
    type: 'functionCall',
    name,
    args,
    line: lineNum,
  };
}

export function parseInlineStatements(stmtTexts: string[], lineNum: number): TiStatement[] | null {
  const result: TiStatement[] = [];
  for (const raw of stmtTexts) {
    const s = raw.trim();
    if (!s) { continue; }
    const upper = s.toUpperCase();
    if (/^ELSE\s*;?\s*$/.test(upper) || upper.startsWith('ELSEIF')) { return null; }
    const withSemi = s.endsWith(';') ? s : s + ';';
    const a = tryParseAssignment(withSemi, lineNum);
    if (a) { result.push(a); continue; }
    const fc = tryParseFunctionCall(withSemi, lineNum);
    if (fc) { result.push(fc); continue; }
    const bk = tryParseBareKeyword(withSemi, lineNum);
    if (bk) { result.push(bk); continue; }
    return null;
  }
  return result;
}

export function tryParseSingleLineIf(line: string, lineNum: number): TiIfBlock | null {
  const ifMatch = line.match(/^(IF\s*)\(/i);
  if (!ifMatch) { return null; }
  const openParen = ifMatch[1].length;

  let depth = 1;
  let inStr = false;
  let condEnd = -1;
  for (let j = openParen + 1; j < line.length; j++) {
    const ch = line[j];
    if (ch === "'") { inStr = !inStr; continue; }
    if (inStr) { continue; }
    if (ch === '(') { depth++; }
    else if (ch === ')') {
      depth--;
      if (depth === 0) { condEnd = j; break; }
    }
  }
  if (condEnd === -1) { return null; }

  const condition = line.substring(openParen + 1, condEnd).trim();
  let rest = line.substring(condEnd + 1).trim();
  if (rest.startsWith(';')) { rest = rest.substring(1).trim(); }

  const upperRest = rest.toUpperCase();
  let endifStart = -1;
  let inStr2 = false;
  for (let k = 0; k <= upperRest.length - 5; k++) {
    const ch = rest[k];
    if (ch === "'") { inStr2 = !inStr2; continue; }
    if (inStr2) { continue; }
    if (upperRest.slice(k, k + 5) === 'ENDIF') {
      const prev = k > 0 ? rest[k - 1] : '';
      const next = k + 5 < rest.length ? rest[k + 5] : '';
      if (/\w/.test(prev) || /\w/.test(next)) { continue; }
      endifStart = k;
    }
  }
  if (endifStart === -1) { return null; }

  const bodyText = rest.substring(0, endifStart).trim();
  const stmts = splitStatementsAtDepthZero(bodyText);
  const thenBody = parseInlineStatements(stmts, lineNum);
  if (thenBody === null) { return null; }

  return {
    type: 'if',
    condition,
    thenBody,
    elseIfClauses: [],
    elseBody: [],
    line: lineNum,
  };
}

export const BARE_KEYWORDS: Set<string> = (() => {
  const s = new Set<string>(['processabort', 'break']);
  for (const [lcName, sig] of KNOWN_SIGNATURES) {
    if (sig.minParams === 0 && sig.maxParams === 0 && sig.returnType === 'void') {
      s.add(lcName);
    }
  }
  return s;
})();

export function tryParseBareKeyword(line: string, lineNum: number): TiFunctionCall | null {
  const cleaned = line.endsWith(';') ? line.slice(0, -1).trim() : line.trim();
  if (BARE_KEYWORDS.has(cleaned.toLowerCase())) {
    return { type: 'functionCall', name: cleaned, args: [], line: lineNum };
  }
  return null;
}
