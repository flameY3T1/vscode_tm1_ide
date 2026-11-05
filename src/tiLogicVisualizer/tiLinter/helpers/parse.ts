import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { BARE_KEYWORDS, TI_KEYWORDS } from '../constants';

/**
 * Masks string-literal bodies and `#`-comments with spaces so operator scans
 * don't trip on characters inside strings/comments. Keeps column positions.
 */
export function maskStringsAndComments(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += ' ';
      if (c === "'") {
        if (s[i + 1] === "'") { out += ' '; i++; continue; }
        inStr = false;
      }
      continue;
    }
    if (c === '#') { out += ' '.repeat(s.length - i); break; }
    if (c === "'") { inStr = true; out += ' '; continue; }
    out += c;
  }
  return out;
}

/**
 * Walks backwards from `opIdx` in `expr` to grab the nearest identifier /
 * numeric literal / string literal. Returns '' when no operand is adjacent.
 */
export function extractOperandLeft(expr: string, opIdx: number): string {
  let end = opIdx;
  while (end > 0 && /\s/.test(expr[end - 1])) { end--; }
  if (end === 0) { return ''; }
  if (expr[end - 1] === "'") {
    const start = expr.lastIndexOf("'", end - 2);
    if (start >= 0) { return expr.substring(start, end); }
  }
  let start = end;
  while (start > 0 && /[A-Za-z0-9_.]/.test(expr[start - 1])) { start--; }
  return expr.substring(start, end);
}

export function extractOperandRight(expr: string, opEndIdx: number): string {
  let start = opEndIdx;
  while (start < expr.length && /\s/.test(expr[start])) { start++; }
  if (start === expr.length) { return ''; }
  if (expr[start] === "'") {
    const end = expr.indexOf("'", start + 1);
    if (end >= 0) { return expr.substring(start, end + 1); }
  }
  let end = start;
  while (end < expr.length && /[A-Za-z0-9_.]/.test(expr[end])) { end++; }
  return expr.substring(start, end);
}

/**
 * Remove single-quoted string literals from an expression so their contents
 * are not mistaken for variable identifiers. Handles escaped single quotes ('').
 */
export function stripStringLiterals(expr: string): string {
  return expr.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Extract all variable identifiers from a condition/expression string.
 * Excludes keywords, known function names, and bare keywords.
 * Returns a Set of lowercase variable names.
 */
export function extractIdentifiers(expression: string): Set<string> {
  const ids = new Set<string>();
  const matches = expression.match(/(?<![A-Za-zÄÖÜäöüß0-9_])[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*(?![A-Za-zÄÖÜäöüß0-9_])/g);
  if (!matches) return ids;

  for (const m of matches) {
    const lower = m.toLowerCase();
    if (TI_KEYWORDS.has(lower)) continue;
    if (KNOWN_SIGNATURES.has(lower)) continue;
    if (BARE_KEYWORDS.has(lower)) continue;
    ids.add(lower);
  }
  return ids;
}

/**
 * Split a string by commas, but only at parenthesis depth 0.
 * Respects nested parentheses and string literals.
 */
export function splitByCommaAtDepthZero(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      current += ch;
      if (ch === "'") {
        inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }

    if (ch === '(') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ')') {
      depth--;
      current += ch;
      continue;
    }

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}
