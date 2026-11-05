/**
 * Statement-level parser. Splits a TI section's source into logical lines
 * (via existing `joinContinuationLines`), classifies each as assignment /
 * function-call statement / no-op (comment or blank), and parses the
 * right-hand side / argument list as expressions.
 */

import { joinContinuationLines } from '../../tiLogicVisualizer/tiParser';
import { parseExpression, ParseError } from './parseExpr';
import type { Statement, StmtIf, StmtWhile } from './statement';
import type { Expr } from './expr';

export type ParseStatementsResult = {
  statements: Statement[];
  errors: { line: number; message: string }[];
};

// TI names may carry non-ASCII letters (umlauts): 12 of 280 live processes
// failed to parse with an ASCII-only class (measured 2026-10-18).
const ASSIGN_RE = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*([\s\S]+);?\s*$/u;
const CALL_RE = /^([\p{L}_][\p{L}\p{N}_]*)\s*\(([\s\S]*)\)\s*;?\s*$/u;

// Statements valid without parentheses: block keywords, control-flow calls and
// the zero-argument functions. ponytail: hand list, extend when a live process
// uses another zero-argument function bare.
const BARE_STATEMENTS: ReadonlySet<string> = new Set([
  'ELSE', 'ENDIF', 'END', 'BREAK',
  'ITEMSKIP', 'ITEMREJECT', 'PROCESSQUIT', 'PROCESSBREAK', 'PROCESSERROR', 'CHOREQUIT',
  'SAVEDATAALL', 'SECURITYREFRESH', 'DELETEALLPERSISTENTFEEDERS', 'ENABLEBULKLOADMODE', 'DISABLEBULKLOADMODE',
]);

function stripTrailingSemicolon(s: string): string {
  return s.replace(/;\s*$/, '');
}

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  if (t.startsWith('#')) return true;
  if (t.startsWith('//')) return true;
  if (t.startsWith('/*')) return true;
  return false;
}

/** Split a logical line on top-level `;` so multi-statement lines like
 * `x = 1; CellPutN(x, 'C', 'a');` parse as 2 statements. Honors strings +
 * nested parens.
 */
function splitTopLevelStatements(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      buf += c;
      if (c === "'") {
        if (line[i + 1] === "'") {
          buf += "'";
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      buf += c;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      continue;
    }
    if (c === ')') {
      depth--;
      buf += c;
      continue;
    }
    if (c === ';' && depth === 0) {
      const t = buf.trim();
      if (t !== '') out.push(t);
      buf = '';
      continue;
    }
    buf += c;
  }
  const tail = buf.trim();
  if (tail !== '') out.push(tail);
  return out;
}

function splitTopLevelArgs(argString: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  let inString = false;

  for (let i = 0; i < argString.length; i++) {
    const c = argString[i];
    if (inString) {
      buf += c;
      if (c === "'") {
        if (argString[i + 1] === "'") {
          buf += "'";
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (c === "'") {
      inString = true;
      buf += c;
      continue;
    }
    if (c === '(') {
      depth++;
      buf += c;
      continue;
    }
    if (c === ')') {
      depth--;
      buf += c;
      continue;
    }
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== '' || out.length > 0) out.push(buf.trim());
  return out;
}

function parseArgList(argString: string): Expr[] {
  const trimmed = argString.trim();
  if (trimmed === '') return [];
  return splitTopLevelArgs(trimmed).map(parseExpression);
}

export function parseStatements(source: string): ParseStatementsResult {
  const statements: Statement[] = [];
  const errors: { line: number; message: string }[] = [];

  const rawLines = source.replace(/\r\n/g, '\n').split('\n');
  const joined = joinContinuationLines(rawLines);

  for (let i = 0; i < joined.length; i++) {
    const line = joined[i];
    const lineNo = i + 1;

    if (isBlankOrComment(line)) {
      statements.push({ kind: 'noop', line: lineNo });
      continue;
    }

    for (const part of splitTopLevelStatements(line)) {
      const trimmed = part;
      const noSemi = stripTrailingSemicolon(trimmed);

      const callMatch = CALL_RE.exec(noSemi);
      if (callMatch && !noSemi.includes('=')) {
        const name = callMatch[1];
        const argString = callMatch[2];
        try {
          statements.push({ kind: 'call', name, args: parseArgList(argString), line: lineNo });
        } catch (e) {
          errors.push({
            line: lineNo,
            message: e instanceof ParseError ? e.message : String(e),
          });
        }
        continue;
      }

      const assignMatch = ASSIGN_RE.exec(noSemi);
      if (assignMatch) {
        const target = assignMatch[1];
        const rhs = assignMatch[2];
        try {
          statements.push({ kind: 'assign', target, value: parseExpression(rhs), line: lineNo });
        } catch (e) {
          errors.push({
            line: lineNo,
            message: e instanceof ParseError ? e.message : String(e),
          });
        }
        continue;
      }

      if (callMatch) {
        const name = callMatch[1];
        const argString = callMatch[2];
        try {
          statements.push({ kind: 'call', name, args: parseArgList(argString), line: lineNo });
        } catch (e) {
          errors.push({
            line: lineNo,
            message: e instanceof ParseError ? e.message : String(e),
          });
        }
        continue;
      }

      // Bare identifier (no parens, no `=`): a keyword (ELSE, ENDIF, ITEMSKIP, …,
      // matched upper-case by the block builder) or a zero-argument function TI
      // accepts without parentheses (`SaveDataAll;` in live processes). Any other
      // name (`vCount;`, `ENDIFF;`) stays a parse error, as TI rejects it.
      const keywordMatch = /^([\p{L}_][\p{L}\p{N}_]*)$/u.exec(noSemi);
      if (keywordMatch && BARE_STATEMENTS.has(keywordMatch[1].toUpperCase())) {
        statements.push({ kind: 'call', name: keywordMatch[1].toUpperCase(), args: [], line: lineNo });
        continue;
      }

      errors.push({
        line: lineNo,
        message: `unrecognised statement: ${trimmed.slice(0, 80)}`,
      });
      statements.push({ kind: 'noop', line: lineNo });
    }
  }

  return { statements: buildBlocks(statements), errors };
}

/**
 * Group flat statements into nested IF/WHILE blocks. Recursive — nested
 * IF/WHILE are consumed by the inner call so depth tracking isn't needed.
 */
function buildBlocks(flat: Statement[]): Statement[] {
  const out: Statement[] = [];
  let i = 0;
  while (i < flat.length) {
    const s = flat[i];
    if (s.kind === 'call') {
      const name = s.name.toUpperCase();
      if (name === 'IF') {
        const block = collectIfBlock(flat, i);
        out.push(block.stmt);
        i = block.next;
        continue;
      }
      if (name === 'WHILE') {
        const block = collectWhileBlock(flat, i);
        out.push(block.stmt);
        i = block.next;
        continue;
      }
      // Top-level ELSE/ENDIF/END without matching opener — treat as noop
      // (will surface via parse-error handling later if needed).
      if (name === 'ELSE' || name === 'ENDIF' || name === 'END' || name === 'ELSEIF') {
        out.push({ kind: 'noop', line: s.line });
        i++;
        continue;
      }
    }
    out.push(s);
    i++;
  }
  return out;
}

function collectIfBlock(
  flat: Statement[],
  start: number,
): { stmt: StmtIf; next: number } {
  const head = flat[start] as Extract<Statement, { kind: 'call' }>;
  const cond = head.args[0];
  const branches: StmtIf['branches'] = [{ cond, body: [] }];
  let currentBody = branches[0].body;
  let i = start + 1;
  while (i < flat.length) {
    const s = flat[i];
    if (s.kind === 'call') {
      const name = s.name.toUpperCase();
      if (name === 'IF') {
        const nested = collectIfBlock(flat, i);
        currentBody.push(nested.stmt);
        i = nested.next;
        continue;
      }
      if (name === 'WHILE') {
        const nested = collectWhileBlock(flat, i);
        currentBody.push(nested.stmt);
        i = nested.next;
        continue;
      }
      if (name === 'ELSEIF') {
        branches.push({ cond: s.args[0], body: [] });
        currentBody = branches[branches.length - 1].body;
        i++;
        continue;
      }
      if (name === 'ELSE') {
        branches.push({ cond: undefined, body: [] });
        currentBody = branches[branches.length - 1].body;
        i++;
        continue;
      }
      if (name === 'ENDIF') {
        i++;
        break;
      }
    }
    currentBody.push(s);
    i++;
  }
  return { stmt: { kind: 'if', branches, line: head.line }, next: i };
}

function collectWhileBlock(
  flat: Statement[],
  start: number,
): { stmt: StmtWhile; next: number } {
  const head = flat[start] as Extract<Statement, { kind: 'call' }>;
  const cond = head.args[0];
  const body: Statement[] = [];
  let i = start + 1;
  while (i < flat.length) {
    const s = flat[i];
    if (s.kind === 'call') {
      const name = s.name.toUpperCase();
      if (name === 'IF') {
        const nested = collectIfBlock(flat, i);
        body.push(nested.stmt);
        i = nested.next;
        continue;
      }
      if (name === 'WHILE') {
        const nested = collectWhileBlock(flat, i);
        body.push(nested.stmt);
        i = nested.next;
        continue;
      }
      if (name === 'END') {
        i++;
        break;
      }
    }
    body.push(s);
    i++;
  }
  return { stmt: { kind: 'while', cond, body, line: head.line }, next: i };
}
