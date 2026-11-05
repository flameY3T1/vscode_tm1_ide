/**
 * AST node types for the expression sub-grammar that the simulator
 * understands (Phase α): literals, identifiers, parens, unary +/-,
 * binary +/-/star/slash/pipe (string-concat), and built-in function calls.
 *
 * Discriminated by `kind` so the evaluator can switch without instanceof.
 */

export type ExprNumLit = { kind: 'numLit'; value: number };
export type ExprStrLit = { kind: 'strLit'; value: string };
export type ExprIdent = { kind: 'ident'; name: string };
export type ExprParen = { kind: 'paren'; inner: Expr };
export type ExprUnary = { kind: 'unary'; op: '+' | '-'; expr: Expr };
export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '\\'
  | ':'
  | '|'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | '@='
  | '@<>'
  | '&'
  | '%';

export type ExprBinary = {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
};
export type ExprCall = { kind: 'call'; name: string; args: Expr[] };

export type Expr =
  | ExprNumLit
  | ExprStrLit
  | ExprIdent
  | ExprParen
  | ExprUnary
  | ExprBinary
  | ExprCall;
