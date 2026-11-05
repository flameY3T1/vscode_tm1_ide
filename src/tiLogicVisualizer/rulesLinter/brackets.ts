/**
 * [...] cell-reference extraction + syntax validation + dim-ref parsing.
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

import { neutralizeLine } from './helpers';
import type { BracketDimRef } from './types';

export {};

export function extractBracketRefs(line: string): string[] {
  const neutralized = neutralizeLine(line);
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < neutralized.length; i++) {
    const ch = neutralized[i];
    if (ch === '[') {
      if (depth === 0) { start = i + 1; }
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        results.push(line.slice(start, i).trim());
        start = -1;
      }
    }
  }
  return results;
}

/** Localizable syntax-error shape: English l10n key + positional args (no [rule-id] prefix). */
export interface BracketRefSyntaxError {
  /**
   * 'malformed' — genuinely broken, e.g. a stray colon or an unbalanced brace.
   * 'unqualified' — syntactically fine TM1 (`['Umsatz']`), flagged only as a style
   * hint because an unqualified element name is ambiguous across dimensions. The two
   * carry different rule ids so a caller can silence the hint without losing the error.
   */
  kind: 'malformed' | 'unqualified';
  messageKey: string;
  messageArgs?: string[];
}

export function validateBracketRefSyntax(content: string): BracketRefSyntaxError | null {
  if (content.trim() === '') { return null; }
  if (!content.includes("'")) { return null; }

  // Optional hierarchy segment between dimension and element/set:
  // TM1 allows 'Dim':'Elem' and 'Dim':'Hier':'Elem' (DIM:HIER:ELEM).
  const hierOpt    = `(?:'[^']+'\\s*:\\s*)?`;
  const singleElem = `'[^']+'\\s*:\\s*${hierOpt}'[^']+'`;
  const multiElem  = `'[^']+'\\s*:\\s*${hierOpt}\\{\\s*'[^']+'(?:\\s*,\\s*'[^']+')*\\s*\\}`;
  const dimSpec    = `(?:${multiElem}|${singleElem})`;
  // Unqualified element: ['Umsatz'], ['Actual','Jan'] — valid TM1. The dimension
  // qualifier is only needed when the element name occurs in more than one dimension.
  // Reported as kind 'unqualified' so lintSync can give it its own rule id, separate
  // from a genuine syntax error.
  const bareElem   = `'[^']+'`;
  const fullRe     = new RegExp(`^\\s*${dimSpec}(?:\\s*,\\s*${dimSpec})*\\s*$`);

  if (fullRe.test(content)) { return null; }

  const parts = splitTopLevelCommas(content);
  const partRe = new RegExp(`^\\s*${dimSpec}\\s*$`);
  const bareRe = new RegExp(`^\\s*${bareElem}\\s*$`);
  for (const part of parts) {
    if (!partRe.test(part)) {
      if (bareRe.test(part)) {
        return {
          kind: 'unqualified',
          messageKey: `'{0}' names an element without its dimension. That is valid TM1, but ambiguous when the element name occurs in more than one dimension.`,
          messageArgs: [part.trim()],
        };
      }
      return {
        kind: 'malformed',
        messageKey: `'{0}' does not match the format 'Dimension':'Element', 'Dimension':'Hierarchy':'Element' or 'Dimension':{'E1','E2'}.`,
        messageArgs: [part.trim()],
      };
    }
  }
  return {
    kind: 'malformed',
    messageKey: `Cell reference does not match the format ['Dimension':'Element'], ['Dimension':'Hierarchy':'Element'] or ['Dimension':{'E1','E2'}].`,
  };
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '{') { depth++; }
    else if (ch === '}') { depth = Math.max(0, depth - 1); }
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.filter(p => p.trim().length > 0);
}

export function parseBracketDimRefs(content: string): BracketDimRef[] {
  const result: BracketDimRef[] = [];
  // Optional hierarchy segment (m[2]) between dimension and element/set:
  // 'Dim':'Hier':'Elem'. m[3] = single element, m[4] = set.
  const dimSpecRe = /'([^']+)'\s*:\s*(?:'([^']+)'\s*:\s*)?(?:'([^']+)'|\{([^}]+)\})/g;
  let m: RegExpExecArray | null;
  while ((m = dimSpecRe.exec(content)) !== null) {
    const dim = m[1];
    const hier = m[2];
    if (m[3] !== undefined) {
      result.push({ dim, hier, elems: [m[3]] });
    } else if (m[4] !== undefined) {
      const elems = [...m[4].matchAll(/'([^']+)'/g)].map(r => r[1]);
      result.push({ dim, hier, elems });
    }
  }
  return result;
}
