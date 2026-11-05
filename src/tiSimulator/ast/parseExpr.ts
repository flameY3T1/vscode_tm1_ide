/**
 * Hand-written recursive-descent parser for TI expressions (Phase α).
 *
 * Grammar:
 *   expr      := concat
 *   concat    := add ('|' add)*
 *   add       := mul (('+'|'-') mul)*
 *   mul       := unary (('*'|'/') unary)*
 *   unary     := ('-'|'+') unary | primary
 *   primary   := number | string | call | ident | '(' expr ')'
 *   call      := ident '(' (expr (',' expr)*)? ')'
 */

import type { Expr } from './expr';

import type { BinaryOp } from './expr';

type Tok =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'op'; value: BinaryOp; pos: number }
  | { kind: 'lparen'; pos: number }
  | { kind: 'rparen'; pos: number }
  | { kind: 'comma'; pos: number }
  | { kind: 'eof'; pos: number };

const IDENT_CHAR_RE = /[\p{L}\p{N}_]/u;

export class ParseError extends Error {
  constructor(message: string, public readonly position: number) {
    super(`${message} (pos ${position})`);
    this.name = 'ParseError';
  }
}

function tokenize(src: string): Tok[] {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (c === '(') {
      tokens.push({ kind: 'lparen', pos: i });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', pos: i });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma', pos: i });
      i++;
      continue;
    }

    // TI hierarchy-qualified element ref: `hier:elem`. Treated as string
    // concat with a `:` separator so the value remains a usable string for
    // downstream calls (CellIsUpdateable, ElementAttr*, etc.).
    if (c === ':') {
      tokens.push({ kind: 'op', value: ':' as BinaryOp, pos: i });
      i++;
      continue;
    }

    // Multi-char operators (try longest match first).
    if (c === '@' && src[i + 1] === '<' && src[i + 2] === '>') {
      tokens.push({ kind: 'op', value: '@<>', pos: i });
      i += 3;
      continue;
    }
    if (c === '@' && src[i + 1] === '=') {
      tokens.push({ kind: 'op', value: '@=', pos: i });
      i += 2;
      continue;
    }
    if (c === '<' && src[i + 1] === '>') {
      tokens.push({ kind: 'op', value: '<>', pos: i });
      i += 2;
      continue;
    }
    if (c === '<' && src[i + 1] === '=') {
      tokens.push({ kind: 'op', value: '<=', pos: i });
      i += 2;
      continue;
    }
    if (c === '>' && src[i + 1] === '=') {
      tokens.push({ kind: 'op', value: '>=', pos: i });
      i += 2;
      continue;
    }

    if (
      c === '+' ||
      c === '-' ||
      c === '*' ||
      c === '/' ||
      c === '\\' ||
      c === '|' ||
      c === '=' ||
      c === '<' ||
      c === '>' ||
      c === '&' ||
      c === '%'
    ) {
      tokens.push({ kind: 'op', value: c as BinaryOp, pos: i });
      i++;
      continue;
    }

    if (c === "'") {
      const startPos = i;
      i++;
      let buf = '';
      let closed = false;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            buf += "'";
            i += 2;
            continue;
          }
          i++;
          tokens.push({ kind: 'str', value: buf, pos: startPos });
          closed = true;
          break;
        }
        buf += src[i];
        i++;
      }
      if (!closed) {
        throw new ParseError('unterminated string literal', startPos);
      }
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const startPos = i;
      let buf = '';
      while (i < src.length && /[0-9.]/.test(src[i])) {
        buf += src[i];
        i++;
      }
      const n = Number(buf);
      if (!Number.isFinite(n)) {
        throw new ParseError(`invalid number literal '${buf}'`, startPos);
      }
      tokens.push({ kind: 'num', value: n, pos: startPos });
      continue;
    }

    if (/[\p{L}_]/u.test(c)) {
      const startPos = i;
      let buf = '';
      while (i < src.length && IDENT_CHAR_RE.test(src[i])) {
        buf += src[i];
        i++;
      }
      tokens.push({ kind: 'ident', value: buf, pos: startPos });
      continue;
    }

    throw new ParseError(`unexpected character '${c}'`, i);
  }

  tokens.push({ kind: 'eof', pos: i });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Tok[]) {}

  private peek(): Tok {
    return this.tokens[this.pos];
  }
  private advance(): Tok {
    return this.tokens[this.pos++];
  }
  private check(kind: Tok['kind']): boolean {
    return this.peek().kind === kind;
  }
  private checkOp(op: BinaryOp): boolean {
    const t = this.peek();
    return t.kind === 'op' && t.value === op;
  }
  private expect(kind: Tok['kind']): Tok {
    if (this.peek().kind !== kind) {
      throw new ParseError(`expected ${kind}, got ${this.peek().kind}`, this.peek().pos);
    }
    return this.advance();
  }

  parseExpr(): Expr {
    return this.parseOr();
  }

  // Lowest precedence: % (or)
  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.checkOp('%')) {
      this.advance();
      const right = this.parseAnd();
      left = { kind: 'binary', op: '%', left, right };
    }
    return left;
  }

  // Next: & (and)
  private parseAnd(): Expr {
    let left = this.parseComparison();
    while (this.checkOp('&')) {
      this.advance();
      const right = this.parseComparison();
      left = { kind: 'binary', op: '&', left, right };
    }
    return left;
  }

  // Next: comparisons (=, <>, <, >, <=, >=, @=, @<>)
  private parseComparison(): Expr {
    let left = this.parseConcat();
    while (
      this.checkOp('=') ||
      this.checkOp('<>') ||
      this.checkOp('<') ||
      this.checkOp('>') ||
      this.checkOp('<=') ||
      this.checkOp('>=') ||
      this.checkOp('@=') ||
      this.checkOp('@<>')
    ) {
      const op = (this.advance() as Extract<Tok, { kind: 'op' }>).value;
      const right = this.parseConcat();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseConcat(): Expr {
    let left = this.parseAdd();
    while (this.checkOp('|') || this.checkOp(':')) {
      const op = (this.advance() as Extract<Tok, { kind: 'op' }>).value as '|' | ':';
      const right = this.parseAdd();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    while (this.checkOp('+') || this.checkOp('-')) {
      const op = (this.advance() as Extract<Tok, { kind: 'op' }>).value as '+' | '-';
      const right = this.parseMul();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMul(): Expr {
    let left = this.parseUnary();
    while (this.checkOp('*') || this.checkOp('/') || this.checkOp('\\')) {
      const op = (this.advance() as Extract<Tok, { kind: 'op' }>).value as '*' | '/' | '\\';
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.checkOp('+') || this.checkOp('-')) {
      const op = (this.advance() as Extract<Tok, { kind: 'op' }>).value as '+' | '-';
      const expr = this.parseUnary();
      return { kind: 'unary', op, expr };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (t.kind === 'num') {
      this.advance();
      return { kind: 'numLit', value: t.value };
    }
    if (t.kind === 'str') {
      this.advance();
      return { kind: 'strLit', value: t.value };
    }
    if (t.kind === 'lparen') {
      this.advance();
      const inner = this.parseExpr();
      this.expect('rparen');
      return { kind: 'paren', inner };
    }
    if (t.kind === 'ident') {
      const name = t.value;
      this.advance();
      if (this.check('lparen')) {
        this.advance();
        const args: Expr[] = [];
        if (!this.check('rparen')) {
          args.push(this.parseExpr());
          while (this.check('comma')) {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        this.expect('rparen');
        return { kind: 'call', name, args };
      }
      return { kind: 'ident', name };
    }
    throw new ParseError(`unexpected token '${t.kind}'`, t.pos);
  }

  expectEof(): void {
    if (!this.check('eof')) {
      const t = this.peek();
      throw new ParseError(`unexpected trailing token '${t.kind}'`, t.pos);
    }
  }
}

export function parseExpression(src: string): Expr {
  const tokens = tokenize(src);
  const p = new Parser(tokens);
  const expr = p.parseExpr();
  p.expectEof();
  return expr;
}
