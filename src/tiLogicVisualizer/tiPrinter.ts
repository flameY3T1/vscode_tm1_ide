import {
  TiAst,
  TiStatement,
  TiAssignment,
  TiIfBlock,
  TiWhileBlock,
  TiFunctionCall,
} from './types';

/**
 * Converts a TI AST back into syntactically valid TI source code.
 * Used primarily for round-trip testing of the parser.
 */
export function printTiAst(ast: TiAst): string {
  return printStatements(ast, 0);
}

function printStatements(statements: TiStatement[], depth: number): string {
  return statements.map(stmt => printStatement(stmt, depth)).join('\n');
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function printStatement(stmt: TiStatement, depth: number): string {
  switch (stmt.type) {
    case 'assignment':
      return printAssignment(stmt, depth);
    case 'if':
      return printIfBlock(stmt, depth);
    case 'while':
      return printWhileBlock(stmt, depth);
    case 'functionCall':
      return printFunctionCall(stmt, depth);
  }
}

function printAssignment(stmt: TiAssignment, depth: number): string {
  return `${indent(depth)}${stmt.variable} = ${stmt.expression};`;
}

function printIfBlock(stmt: TiIfBlock, depth: number): string {
  const lines: string[] = [];

  lines.push(`${indent(depth)}IF(${stmt.condition});`);
  if (stmt.thenBody.length > 0) {
    lines.push(printStatements(stmt.thenBody, depth + 1));
  }

  for (const clause of stmt.elseIfClauses) {
    lines.push(`${indent(depth)}ELSEIF(${clause.condition});`);
    if (clause.body.length > 0) {
      lines.push(printStatements(clause.body, depth + 1));
    }
  }

  if (stmt.elseBody.length > 0) {
    lines.push(`${indent(depth)}ELSE;`);
    lines.push(printStatements(stmt.elseBody, depth + 1));
  }

  lines.push(`${indent(depth)}ENDIF;`);

  return lines.join('\n');
}

function printWhileBlock(stmt: TiWhileBlock, depth: number): string {
  const lines: string[] = [];

  lines.push(`${indent(depth)}WHILE(${stmt.condition});`);
  if (stmt.body.length > 0) {
    lines.push(printStatements(stmt.body, depth + 1));
  }
  lines.push(`${indent(depth)}END;`);

  return lines.join('\n');
}

function printFunctionCall(stmt: TiFunctionCall, depth: number): string {
  return `${indent(depth)}${stmt.name}(${stmt.args.join(', ')});`;
}
