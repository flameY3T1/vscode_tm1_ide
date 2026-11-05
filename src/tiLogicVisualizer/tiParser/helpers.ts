/**
 * Stateless helpers.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

export {};

export function splitParams(paramsStr: string): string[] {
  const params: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < paramsStr.length; i++) {
    const ch = paramsStr[i];

    if (inString) {
      current += ch;
      if (ch === stringChar) { inString = false; }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      current += ch;
      continue;
    }

    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth--; current += ch; continue; }
    if (ch === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) { params.push(current.trim()); }
  return params;
}

export function splitStatementsAtDepthZero(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let inStr = false;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k];
    if (ch === "'") { inStr = !inStr; current += ch; continue; }
    if (!inStr) {
      if (ch === '(') { depth++; }
      else if (ch === ')') { depth--; }
      else if (ch === ';' && depth === 0) {
        if (current.trim()) { out.push(current.trim()); }
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) { out.push(current.trim()); }
  return out;
}

export function hasTrailingEndif(line: string): boolean {
  const upper = line.toUpperCase();
  let inStr = false;
  for (let k = 0; k <= upper.length - 5; k++) {
    const ch = line[k];
    if (ch === "'") { inStr = !inStr; continue; }
    if (inStr) { continue; }
    if (upper.slice(k, k + 5) === 'ENDIF') {
      const prev = k > 0 ? line[k - 1] : '';
      const next = k + 5 < line.length ? line[k + 5] : '';
      if (/\w/.test(prev) || /\w/.test(next)) { continue; }
      return true;
    }
  }
  return false;
}

export function detectCellGet(expression: string): { fn: 'CellGetN' | 'CellGetS'; params: string[] } | undefined {
  const match = expression.match(/\b(CellGetN|CellGetS)\s*\(([^)]*)\)/i);
  if (!match) return undefined;

  const normalizedFn: 'CellGetN' | 'CellGetS' = match[1].toUpperCase().includes('GETN') ? 'CellGetN' : 'CellGetS';
  const paramsStr = match[2].trim();
  const params = paramsStr ? splitParams(paramsStr) : [];

  return { fn: normalizedFn, params };
}

export function extractCondition(line: string, keyword: string): string {
  const afterKeyword = line.substring(keyword.length).trim();

  if (!afterKeyword.startsWith('(')) {
    return afterKeyword.replace(/;$/, '').trim();
  }

  let depth = 0;
  let endIdx = -1;
  for (let j = 0; j < afterKeyword.length; j++) {
    if (afterKeyword[j] === '(') depth++;
    if (afterKeyword[j] === ')') {
      depth--;
      if (depth === 0) {
        endIdx = j;
        break;
      }
    }
  }

  if (endIdx === -1) {
    return afterKeyword.replace(/;$/, '').trim();
  }

  return afterKeyword.substring(1, endIdx).trim();
}
