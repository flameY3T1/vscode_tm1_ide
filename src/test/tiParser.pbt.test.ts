import fc from 'fast-check';
import { TI_KEYWORDS } from '../tiLogicVisualizer/tiLinter/constants';
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import { printTiAst } from '../tiLogicVisualizer/tiPrinter';
import type {
  TiAst,
  TiStatement,
  TiAssignment,
  TiIfBlock,
  TiWhileBlock,
  TiFunctionCall,
} from '../tiLogicVisualizer/types';

// ── Helpers ──────────────────────────────────────────────────────────


/** Strip `line` numbers from an AST so structural comparison ignores positions. */
function stripLines(ast: TiAst): unknown {
  return ast.map(stripStmtLines);
}

function stripStmtLines(stmt: TiStatement): unknown {
  switch (stmt.type) {
    case 'assignment': {
      const { line: _line, ...rest } = stmt;
      return rest;
    }
    case 'functionCall': {
      const { line: _line, ...rest } = stmt;
      return rest;
    }
    case 'if': {
      const { line: _line, ...rest } = stmt;
      return {
        ...rest,
        thenBody: rest.thenBody.map(stripStmtLines),
        elseIfClauses: rest.elseIfClauses.map(c => ({
          condition: c.condition,
          body: c.body.map(stripStmtLines),
        })),
        elseBody: rest.elseBody.map(stripStmtLines),
      };
    }
    case 'while': {
      const { line: _line, ...rest } = stmt;
      return {
        ...rest,
        body: rest.body.map(stripStmtLines),
      };
    }
  }
}

/** Generate a string of given length from a character set. */
function alphaStringArb(minLen: number, maxLen: number, chars: string): fc.Arbitrary<string> {
  return fc.array(
    fc.constantFrom(...chars.split('')),
    { minLength: minLen, maxLength: maxLen },
  ).map(arr => arr.join(''));
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ── Arbitraries ──────────────────────────────────────────────────────

/** Variable name: starts with letter, alphanumeric, avoids TI keywords. */
const varNameArb = fc
  .tuple(
    fc.constantFrom(...LOWER.split('')),
    alphaStringArb(0, 6, ALNUM),
  )
  .map(([first, rest]) => first + rest)
  .filter(name => !TI_KEYWORDS.has(name.toLowerCase()));

/** Simple numeric expression (no semicolons, no newlines). */
const numericExprArb = fc.oneof(
  fc.integer({ min: -9999, max: 9999 }).map(String),
  fc.tuple(varNameArb, fc.constantFrom(' + ', ' - ', ' * '), varNameArb)
    .map(([a, op, b]) => `${a}${op}${b}`),
  varNameArb,
);

/** Simple string expression. */
const stringExprArb = alphaStringArb(1, 10, ALNUM + ' ')
  .map(s => `'${s}'`);

/** Simple expression (no semicolons, no newlines, no parentheses that could confuse parser). */
const simpleExprArb = fc.oneof(numericExprArb, stringExprArb);

/** CellGet expression: CellGetN('cube', 'dim', 'elem') or CellGetS(...). */
const cellGetExprArb = fc.tuple(
  fc.constantFrom('CellGetN', 'CellGetS'),
  alphaStringArb(1, 6, LOWER),
  alphaStringArb(1, 6, LOWER),
  alphaStringArb(1, 6, LOWER),
).map(([fn, cube, dim, elem]) => `${fn}('${cube}', '${dim}', '${elem}')`);

/** Simple condition expression for IF/WHILE. */
const conditionArb = fc.tuple(
  varNameArb,
  fc.constantFrom(' > ', ' < ', ' >= ', ' <= ', ' = ', ' <> '),
  fc.integer({ min: 0, max: 999 }).map(String),
).map(([v, op, n]) => `${v}${op}${n}`);

/** Function name: starts with uppercase letter, avoids TI keywords. */
const funcNameArb = fc
  .tuple(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
    alphaStringArb(1, 8, ALNUM),
  )
  .map(([first, rest]) => first + rest)
  .filter(name => !TI_KEYWORDS.has(name.toLowerCase()));

/** Function argument: simple value without semicolons/newlines/commas. */
const funcArgArb = fc.oneof(
  fc.integer({ min: -999, max: 999 }).map(String),
  alphaStringArb(1, 6, ALNUM).map(s => `'${s}'`),
  varNameArb,
);

// ── AST Arbitraries (depth-limited) ─────────────────────────────────

function assignmentArb(): fc.Arbitrary<TiAssignment> {
  return fc.oneof(
    fc.tuple(varNameArb, simpleExprArb).map(([variable, expression]) => ({
      type: 'assignment' as const,
      variable,
      expression,
      isExternal: false,
      line: 1,
    })),
    fc.tuple(varNameArb, cellGetExprArb).map(([variable, expression]) => {
      const match = expression.match(/^(CellGetN|CellGetS)\((.+)\)$/);
      const fn = match![1] as 'CellGetN' | 'CellGetS';
      const paramsStr = match![2];
      const params = paramsStr.split(',').map(p => p.trim());
      return {
        type: 'assignment' as const,
        variable,
        expression,
        isExternal: true,
        cellGetInfo: { fn, params },
        line: 1,
      };
    }),
  );
}

function functionCallArb(): fc.Arbitrary<TiFunctionCall> {
  return fc.tuple(
    funcNameArb,
    fc.array(funcArgArb, { minLength: 0, maxLength: 3 }),
  ).map(([name, args]) => ({
    type: 'functionCall' as const,
    name,
    args,
    line: 1,
  }));
}

/** Leaf statement (no nesting). */
function leafStatementArb(): fc.Arbitrary<TiStatement> {
  return fc.oneof(assignmentArb(), functionCallArb());
}

/** Statement arbitrary with bounded nesting depth. */
function statementArb(maxDepth: number): fc.Arbitrary<TiStatement> {
  if (maxDepth <= 0) {
    return leafStatementArb();
  }
  const bodyArb = fc.array(statementArb(maxDepth - 1), { minLength: 0, maxLength: 3 });

  const ifArb: fc.Arbitrary<TiIfBlock> = fc.tuple(
    conditionArb,
    bodyArb,
    fc.array(
      fc.tuple(conditionArb, bodyArb),
      { minLength: 0, maxLength: 2 },
    ),
    fc.oneof(fc.constant([] as TiStatement[]), bodyArb),
  ).map(([condition, thenBody, elseIfs, elseBody]) => ({
    type: 'if' as const,
    condition,
    thenBody,
    elseIfClauses: elseIfs.map(([c, b]) => ({ condition: c, body: b, line: 1 })),
    elseBody,
    line: 1,
  }));

  const whileArb: fc.Arbitrary<TiWhileBlock> = fc.tuple(
    conditionArb,
    bodyArb,
  ).map(([condition, body]) => ({
    type: 'while' as const,
    condition,
    body,
    line: 1,
  }));

  return fc.oneof(
    { weight: 3, arbitrary: leafStatementArb() },
    { weight: 2, arbitrary: ifArb },
    { weight: 1, arbitrary: whileArb },
  );
}

/** Random valid TI AST with bounded depth. */
const tiAstArb: fc.Arbitrary<TiAst> = fc.array(statementArb(2), { minLength: 0, maxLength: 5 });

// ── Property Tests ───────────────────────────────────────────────────

// Feature: ti-logic-visualizer, Property 1: Parser/Printer Round-Trip
describe('Property 1: Parser/Printer Round-Trip', () => {
  // **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.1, 2.2**

  it('print(ast) → parse → ast2 is structurally equivalent to ast', () => {
    fc.assert(
      fc.property(tiAstArb, (ast) => {
        // Print the AST to TI code
        const code = printTiAst(ast);

        // Parse the printed code back
        const result = parseTiCode(code);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        // Compare structurally (ignoring line numbers)
        const stripped1 = stripLines(ast);
        const stripped2 = stripLines(result.ast);
        expect(stripped2).toEqual(stripped1);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: ti-logic-visualizer, Property 2: CellGet detection
describe('Property 2: CellGet detection', () => {
  // **Validates: Requirements 1.3**

  it('assignments with CellGetN/CellGetS have isExternal === true and correct cellGetInfo', () => {
    fc.assert(
      fc.property(varNameArb, cellGetExprArb, (varName, cellGetExpr) => {
        const code = `${varName} = ${cellGetExpr};`;
        const result = parseTiCode(code);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.ast).toHaveLength(1);
        const stmt = result.ast[0];
        expect(stmt.type).toBe('assignment');

        const assignment = stmt as TiAssignment;
        expect(assignment.variable).toBe(varName);
        expect(assignment.isExternal).toBe(true);
        expect(assignment.cellGetInfo).toBeDefined();

        // Extract expected fn and params from the generated expression
        const match = cellGetExpr.match(/^(CellGetN|CellGetS)\((.+)\)$/);
        expect(match).not.toBeNull();

        const expectedFn = match![1] as 'CellGetN' | 'CellGetS';
        const expectedParams = match![2].split(',').map((p: string) => p.trim());

        expect(assignment.cellGetInfo!.fn).toBe(expectedFn);
        expect(assignment.cellGetInfo!.params).toEqual(expectedParams);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: ti-logic-visualizer, Property 3: comments do not change the AST
describe('Property 3: comments do not change the AST', () => {
  // **Validates: Requirements 1.7**

  /** Generate a random comment line starting with #. */
  const commentLineArb = alphaStringArb(0, 30, ALNUM + ' ').map(s => `# ${s}`);

  it('inserting random comment lines between statements does not change the AST', () => {
    fc.assert(
      fc.property(
        tiAstArb,
        fc.array(
          fc.tuple(
            fc.nat(), // insertion position index (will be clamped)
            commentLineArb,
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (ast, commentsToInsert) => {
          // Print the AST to TI code
          const code = printTiAst(ast);

          // Parse the original code (baseline)
          const baselineResult = parseTiCode(code);
          expect(baselineResult.ok).toBe(true);
          if (!baselineResult.ok) return;

          // Split code into lines and insert comments at random positions
          const lines = code.split('\n');
          // Build a new array with comments inserted
          // We insert from the end to avoid shifting indices
          const insertions = commentsToInsert
            .map(([pos, comment]) => ({
              pos: lines.length === 0 ? 0 : pos % (lines.length + 1),
              comment,
            }))
            .sort((a, b) => b.pos - a.pos); // sort descending to insert from end

          const modifiedLines = [...lines];
          for (const { pos, comment } of insertions) {
            modifiedLines.splice(pos, 0, comment);
          }

          const modifiedCode = modifiedLines.join('\n');

          // Parse the modified code
          const modifiedResult = parseTiCode(modifiedCode);
          expect(modifiedResult.ok).toBe(true);
          if (!modifiedResult.ok) return;

          // Both ASTs should be structurally equivalent (ignoring line numbers)
          expect(stripLines(modifiedResult.ast)).toEqual(stripLines(baselineResult.ast));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: ti-logic-visualizer, Property 4: syntax errors are detected
describe('Property 4: syntax errors are detected', () => {
  // **Validates: Requirements 1.6**

  /** Generate an AST that contains at least one IF block at the top level. */
  const astWithIfArb: fc.Arbitrary<TiAst> = fc.tuple(
    fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
    fc.tuple(
      conditionArb,
      fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
    ).map(([condition, body]): TiIfBlock => ({
      type: 'if',
      condition,
      thenBody: body,
      elseIfClauses: [],
      elseBody: [],
      line: 1,
    })),
    fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
  ).map(([before, ifBlock, after]) => [...before, ifBlock, ...after]);

  /** Generate an AST that contains at least one WHILE block at the top level. */
  const astWithWhileArb: fc.Arbitrary<TiAst> = fc.tuple(
    fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
    fc.tuple(
      conditionArb,
      fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
    ).map(([condition, body]): TiWhileBlock => ({
      type: 'while',
      condition,
      body,
      line: 1,
    })),
    fc.array(leafStatementArb(), { minLength: 0, maxLength: 2 }),
  ).map(([before, whileBlock, after]) => [...before, whileBlock, ...after]);

  it('IF block with missing ENDIF is detected as syntax error', () => {
    fc.assert(
      fc.property(astWithIfArb, (ast) => {
        const code = printTiAst(ast);
        const lines = code.split('\n');

        // Find the last ENDIF; line and remove it
        let lastEndifIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim().toUpperCase() === 'ENDIF;') {
            lastEndifIdx = i;
            break;
          }
        }

        // There must be at least one ENDIF since we have an IF block
        expect(lastEndifIdx).toBeGreaterThanOrEqual(0);

        const brokenLines = [...lines];
        brokenLines.splice(lastEndifIdx, 1);
        const brokenCode = brokenLines.join('\n');

        const result = parseTiCode(brokenCode);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.line).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('WHILE block with missing END is detected as syntax error', () => {
    fc.assert(
      fc.property(astWithWhileArb, (ast) => {
        const code = printTiAst(ast);
        const lines = code.split('\n');

        // Find the last END; line and remove it
        let lastEndIdx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].trim().toUpperCase() === 'END;') {
            lastEndIdx = i;
            break;
          }
        }

        // There must be at least one END since we have a WHILE block
        expect(lastEndIdx).toBeGreaterThanOrEqual(0);

        const brokenLines = [...lines];
        brokenLines.splice(lastEndIdx, 1);
        const brokenCode = brokenLines.join('\n');

        const result = parseTiCode(brokenCode);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.line).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
