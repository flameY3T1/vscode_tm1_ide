/**
 * Statement-level AST for the simulator (Phase α).
 * Phase α supports: assignment, function-call statement, comments
 * (parsed but represented as `noop`).
 */

import type { Expr } from './expr';

export type StmtAssign = {
  kind: 'assign';
  target: string;
  value: Expr;
  /** 1-based source line number for diagnostics. */
  line: number;
};

export type StmtCall = {
  kind: 'call';
  name: string;
  args: Expr[];
  line: number;
};

export type StmtNoop = { kind: 'noop'; line: number };

export type StmtIf = {
  kind: 'if';
  branches: { cond?: Expr; body: Statement[] }[];
  line: number;
};

export type StmtWhile = {
  kind: 'while';
  cond: Expr;
  body: Statement[];
  line: number;
};

export type Statement = StmtAssign | StmtCall | StmtNoop | StmtIf | StmtWhile;
