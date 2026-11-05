/** Ergebnis des Parsers */
export type TiParseResult =
  | { ok: true; ast: TiAst }
  | { ok: false; error: TiParseError };

export interface TiParseError {
  line: number;
  /** English l10n key (also the raw `.message`). Used for code-detection; render via vscode.l10n.t(messageKey, ...messageArgs). */
  message: string;
  /** English l10n key — same value as `message`; named for symmetry with the display render path. */
  messageKey: string;
  /** Positional args ({0},{1},…) for vscode.l10n.t. */
  messageArgs: (string | number)[];
}

/** AST = Array von Statements */
export type TiAst = TiStatement[];

export type TiStatement =
  | TiAssignment
  | TiIfBlock
  | TiWhileBlock
  | TiFunctionCall;

export interface TiAssignment {
  type: 'assignment';
  variable: string;
  expression: string;
  /** true if the expression contains CellGetN/CellGetS */
  isExternal: boolean;
  /** If isExternal: function name and parameters */
  cellGetInfo?: { fn: 'CellGetN' | 'CellGetS'; params: string[] };
  line: number;
}

export interface TiIfBlock {
  type: 'if';
  condition: string;
  thenBody: TiStatement[];
  elseIfClauses: Array<{ condition: string; body: TiStatement[]; line: number }>;
  elseBody: TiStatement[];
  line: number;
}

export interface TiWhileBlock {
  type: 'while';
  condition: string;
  body: TiStatement[];
  line: number;
}

export interface TiFunctionCall {
  type: 'functionCall';
  name: string;
  args: string[];
  line: number;
}
