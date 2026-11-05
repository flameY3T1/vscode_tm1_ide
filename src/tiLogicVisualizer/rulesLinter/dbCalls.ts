/**
 * DB() call extraction + argument parsing.
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

import { neutralizeLine } from './helpers';
import type { DbCall } from './types';

export {};

function splitArgs(argsStr: string): string[] {
  if (!argsStr.trim()) { return []; }
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';

  for (const ch of argsStr) {
    if (ch === "'" && !inString)      { inString = true;  current += ch; }
    else if (ch === "'" && inString)  { inString = false; current += ch; }
    else if (!inString && ch === '(') { depth++; current += ch; }
    else if (!inString && ch === ')') { depth--; current += ch; }
    else if (!inString && depth === 0 && ch === ',') {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  args.push(current.trim());
  return args.filter(a => a !== '');
}

export function extractDbCalls(line: string): DbCall[] {
  const neutralized = neutralizeLine(line);
  const results: DbCall[] = [];
  const dbRe = /\bDB\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = dbRe.exec(neutralized)) !== null) {
    const openPos = m.index + m[0].length - 1;
    let depth = 1;
    let i = openPos + 1;
    while (i < neutralized.length && depth > 0) {
      if (neutralized[i] === '(')      { depth++; }
      else if (neutralized[i] === ')') { depth--; }
      i++;
    }
    if (depth !== 0) { continue; }

    const argsStr = line.slice(openPos + 1, i - 1);
    const args = splitArgs(argsStr);
    const first = args[0]?.trim() ?? '';
    const cubeName = first.startsWith("'") && first.endsWith("'") && first.length >= 3
      ? first.slice(1, -1)
      : null;

    results.push({ args, cubeName });
  }
  return results;
}
