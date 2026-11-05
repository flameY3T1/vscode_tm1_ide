import fc from 'fast-check';
import { TI_KEYWORDS } from '../tiLogicVisualizer/tiLinter/constants';
import { lintTiAst } from '../tiLogicVisualizer/tiLinter';
import type { TiStatement, TiWhileBlock, TiIfBlock, TiAssignment, TiFunctionCall } from '../tiLogicVisualizer/types';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

// ── Helpers ──────────────────────────────────────────────────────────

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Generate a string of given length from a character set. */
function alphaStringArb(minLen: number, maxLen: number, chars: string): fc.Arbitrary<string> {
  return fc.array(
    fc.constantFrom(...chars.split('')),
    { minLength: minLen, maxLength: maxLen },
  ).map(arr => arr.join(''));
}


/** Variable name: starts with letter, alphanumeric, avoids TI keywords. */
const varNameArb = fc
  .tuple(
    fc.constantFrom(...LOWER.split('')),
    alphaStringArb(1, 5, ALNUM),
  )
  .map(([first, rest]) => first + rest)
  // Exclude TI keywords AND known function names: extractIdentifiers drops
  // KNOWN_SIGNATURES names (e.g. 'exp', 'max', 'day'), so a random collision
  // would make e.g. the endless-loop property flaky.
  .filter(name => !TI_KEYWORDS.has(name.toLowerCase()) && !KNOWN_SIGNATURES.has(name.toLowerCase()));

/** Comparison operator. */
const comparisonOpArb = fc.constantFrom('=', '<>', '>', '<', '>=', '<=');

// ── Property 2: endless loop detection ───────────────────────────────

// Feature: ti-linter, Property 2: endless loop detection
describe('Property 2: endless loop detection', () => {
  // **Validates: Requirements 2.1**

  /**
   * Generate a WHILE block whose condition references at least one variable,
   * and whose body does NOT assign any of those variables.
   *
   * Strategy:
   * - Pick 1-3 "condition variables" for the WHILE condition
   * - Build a condition string like "condVar1 > 0" or "condVar1 = condVar2"
   * - Pick 0-3 "body variables" that are DISJOINT from condition variables
   * - Build body statements that only assign to body variables (not condition variables)
   */
  const endlessLoopWhileArb = fc.tuple(
    // Condition variables (1-3 distinct names)
    fc.uniqueArray(varNameArb, { minLength: 1, maxLength: 3, comparator: (a, b) => a.toLowerCase() === b.toLowerCase() }),
    // Body variables (0-3 distinct names) — will be filtered to exclude condition vars
    fc.uniqueArray(varNameArb, { minLength: 0, maxLength: 3, comparator: (a, b) => a.toLowerCase() === b.toLowerCase() }),
    // Comparison operator for condition
    comparisonOpArb,
    // Right-hand operand: either a numeric literal or a second condition variable
    fc.boolean(),
    // Line number
    fc.integer({ min: 1, max: 500 }),
  ).chain(([condVars, bodyVarCandidates, op, useNumericRhs, line]) => {
    // Ensure body variables are disjoint from condition variables
    const condVarLowerSet = new Set(condVars.map(v => v.toLowerCase()));
    const bodyVars = bodyVarCandidates.filter(v => !condVarLowerSet.has(v.toLowerCase()));

    // Build condition: "condVar1 op condVar2" or "condVar1 op 0"
    const condLeft = condVars[0];
    const condRight = condVars.length > 1 && !useNumericRhs
      ? condVars[1]
      : '0';
    const condition = `${condLeft} ${op} ${condRight}`;

    // Build body: assignments to body-only variables (never to condition variables)
    const bodyStatementsArb: fc.Arbitrary<TiStatement[]> = bodyVars.length === 0
      ? fc.constant([] as TiStatement[])
      : fc.array(
          fc.constantFrom(...bodyVars).map((v): TiAssignment => ({
            type: 'assignment',
            variable: v,
            expression: '1',
            isExternal: false,
            line: line + 1,
          })),
          { minLength: 0, maxLength: 3 },
        );

    return bodyStatementsArb.map((body): TiWhileBlock => ({
      type: 'while',
      condition,
      body,
      line,
    }));
  });

  it('reports endless-loop when no condition variable is modified in the WHILE body', () => {
    fc.assert(
      fc.property(endlessLoopWhileArb, (whileBlock) => {
        const ast = [whileBlock];
        const diagnostics = lintTiAst(ast);

        const endlessLoopDiags = diagnostics.filter(d => d.ruleId === 'endless-loop');
        expect(endlessLoopDiags.length).toBeGreaterThanOrEqual(1);
        expect(endlessLoopDiags[0].line).toBe(whileBlock.line);
        expect(endlessLoopDiags[0].severity).toBe('warning');
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: wrong argument count ─────────────────────────────────

// Feature: ti-linter, Property 3: wrong argument count
describe('Property 3: wrong argument count', () => {
  // **Validates: Requirements 2.2**

  /**
   * Collect known signatures that have a finite constraint we can violate.
   * - For functions with finite maxParams: we can go above maxParams or below minParams
   * - For variadic functions (maxParams === Infinity): we can only go below minParams
   * We filter to signatures where minParams > 0 OR maxParams < Infinity so we can
   * always generate a wrong arg count.
   */
  const sigEntries = [...KNOWN_SIGNATURES.entries()].filter(([, sig]) => {
    // We can always generate too few args if minParams > 0
    // We can generate too many args if maxParams < Infinity
    return sig.minParams > 0 || sig.maxParams < Infinity;
  });

  /**
   * Generator: pick a known signature, then generate an arg count that is
   * outside [minParams, maxParams].
   */
  const wrongArgCountCallArb = fc.tuple(
    fc.constantFrom(...sigEntries),
    fc.boolean(), // true = too few args, false = too many args
    fc.integer({ min: 1, max: 500 }), // line number
  ).chain(([[, sig], tooFew, line]) => {
    let argCountArb: fc.Arbitrary<number>;

    if (tooFew && sig.minParams > 0) {
      // Generate fewer args than minParams
      argCountArb = fc.integer({ min: 0, max: sig.minParams - 1 });
    } else if (!tooFew && sig.maxParams < Infinity) {
      // Generate more args than maxParams
      argCountArb = fc.integer({ min: sig.maxParams + 1, max: sig.maxParams + 10 });
    } else if (sig.minParams > 0) {
      // Can only go below (variadic function)
      argCountArb = fc.integer({ min: 0, max: sig.minParams - 1 });
    } else {
      // Can only go above (maxParams is finite, minParams is 0)
      argCountArb = fc.integer({ min: sig.maxParams + 1, max: sig.maxParams + 10 });
    }

    return argCountArb.map((argCount): { call: TiFunctionCall; sigName: string } => {
      const args = Array.from({ length: argCount }, (_, i) => `'arg${i}'`);
      return {
        call: {
          type: 'functionCall',
          name: sig.name,
          args,
          line,
        },
        sigName: sig.name,
      };
    });
  });

  it('reports wrong-arg-count when a known function is called with incorrect number of arguments', () => {
    fc.assert(
      fc.property(wrongArgCountCallArb, ({ call }) => {
        const ast = [call];
        const diagnostics = lintTiAst(ast);

        const wrongArgDiags = diagnostics.filter(d => d.ruleId === 'wrong-arg-count');
        expect(wrongArgDiags.length).toBeGreaterThanOrEqual(1);
        expect(wrongArgDiags[0].line).toBe(call.line);
        expect(wrongArgDiags[0].severity).toBe('error');
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: operator type incompatibility ────────────────────────

// Feature: ti-linter, Property 4: operator type incompatibility
describe('Property 4: operator type incompatibility', () => {
  // **Validates: Requirements 2.3, 2.4**

  /** String literal: single-quoted text (no inner quotes for simplicity). */
  const stringLiteralArb = alphaStringArb(1, 8, ALNUM).map(s => `'${s}'`);

  /** Numeric literal: integers and decimals, optionally negative. */
  const numericLiteralArb = fc.oneof(
    fc.integer({ min: 0, max: 9999 }).map(n => String(n)),
    fc.tuple(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 99 })).map(([a, b]) => `${a}.${b}`),
    fc.integer({ min: 1, max: 9999 }).map(n => `-${n}`),
  );

  /** Numeric comparison operators. */
  const numericOpArb = fc.constantFrom('=', '<>', '>', '<', '>=', '<=');

  /** @-operators (string comparison). */
  const atOpArb = fc.constantFrom('@=', '@<>', '@>', '@<', '@>=', '@<=');

  it('reports string-compare-without-at when string literals are on both sides of a numeric operator', () => {
    const ifBlockArb = fc.tuple(
      stringLiteralArb,
      numericOpArb,
      stringLiteralArb,
      fc.integer({ min: 1, max: 500 }),
    ).map(([lhs, op, rhs, line]) => ({
      type: 'if' as const,
      condition: `${lhs} ${op} ${rhs}`,
      thenBody: [],
      elseIfClauses: [],
      elseBody: [],
      line,
    }));

    fc.assert(
      fc.property(ifBlockArb, (ifBlock) => {
        const ast = [ifBlock];
        const diagnostics = lintTiAst(ast);

        const matchingDiags = diagnostics.filter(d => d.ruleId === 'string-compare-without-at');
        expect(matchingDiags.length).toBeGreaterThanOrEqual(1);
        expect(matchingDiags[0].line).toBe(ifBlock.line);
        expect(matchingDiags[0].severity).toBe('warning');
      }),
      { numRuns: 100 },
    );
  });

  it('reports numeric-compare-with-at when numeric literals are on both sides of an @-operator', () => {
    const ifBlockArb = fc.tuple(
      numericLiteralArb,
      atOpArb,
      numericLiteralArb,
      fc.integer({ min: 1, max: 500 }),
    ).map(([lhs, op, rhs, line]) => ({
      type: 'if' as const,
      condition: `${lhs} ${op} ${rhs}`,
      thenBody: [],
      elseIfClauses: [],
      elseBody: [],
      line,
    }));

    fc.assert(
      fc.property(ifBlockArb, (ifBlock) => {
        const ast = [ifBlock];
        const diagnostics = lintTiAst(ast);

        const matchingDiags = diagnostics.filter(d => d.ruleId === 'numeric-compare-with-at');
        expect(matchingDiags.length).toBeGreaterThanOrEqual(1);
        expect(matchingDiags[0].line).toBe(ifBlock.line);
        expect(matchingDiags[0].severity).toBe('error');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 5: type consistency in assignments ─────────────────────

// Feature: ti-linter, Property 5: type consistency in assignments
describe('Property 5: type consistency in assignments', () => {
  // **Validates: Requirements 2.5, 2.6, 8.1, 8.2**

  /** String literal: single-quoted text. */
  const stringLiteralArb = alphaStringArb(1, 8, ALNUM).map(s => `'${s}'`);

  /** Numeric literal: positive integers. */
  const numericLiteralArb = fc.integer({ min: 0, max: 9999 }).map(n => String(n));

  /**
   * Generate two assignments to the SAME variable with conflicting types:
   * - Either string first, then numeric
   * - Or numeric first, then string
   *
   * The linter should report type-mismatch-assignment for the second assignment.
   */
  const typeMismatchPairArb = fc.tuple(
    varNameArb,
    fc.boolean(), // true = string first then numeric, false = numeric first then string
    stringLiteralArb,
    numericLiteralArb,
    fc.integer({ min: 1, max: 400 }), // line for first assignment
  ).map(([varName, stringFirst, strLit, numLit, line1]) => {
    const line2 = line1 + 1;
    const firstExpr = stringFirst ? strLit : numLit;
    const secondExpr = stringFirst ? numLit : strLit;

    const assignment1: TiAssignment = {
      type: 'assignment',
      variable: varName,
      expression: firstExpr,
      isExternal: false,
      line: line1,
    };

    const assignment2: TiAssignment = {
      type: 'assignment',
      variable: varName,
      expression: secondExpr,
      isExternal: false,
      line: line2,
    };

    return { assignment1, assignment2, line2 };
  });

  it('reports type-mismatch-assignment when the same variable is assigned conflicting types', () => {
    fc.assert(
      fc.property(typeMismatchPairArb, ({ assignment1, assignment2, line2 }) => {
        const ast = [assignment1, assignment2];
        const diagnostics = lintTiAst(ast);

        const mismatchDiags = diagnostics.filter(d => d.ruleId === 'type-mismatch-assignment');
        expect(mismatchDiags.length).toBeGreaterThanOrEqual(1);
        expect(mismatchDiags[0].line).toBe(line2);
        expect(mismatchDiags[0].severity).toBe('error');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 6: wrong parameter type ─────────────────────────────────

// Feature: ti-linter, Property 6: wrong parameter type
describe('Property 6: wrong parameter type', () => {
  // **Validates: Requirements 2.7, 2.8**

  /**
   * Collect known signatures that have at least one param with type 'string' or 'numeric' (not 'any').
   * For each, record which param indices are typed and what type they expect.
   */
  const typedSigEntries = [...KNOWN_SIGNATURES.entries()]
    .map(([key, sig]) => {
      const typedPositions = sig.params
        .map((p, i) => ({ index: i, type: p.type }))
        .filter(p => p.type === 'string' || p.type === 'numeric');
      return { key, sig, typedPositions };
    })
    .filter(entry => entry.typedPositions.length > 0)
    // Only pick functions where we can provide the correct number of args
    // (non-variadic or variadic with enough typed params within minParams)
    .filter(entry => entry.sig.minParams <= entry.sig.maxParams);

  /** String literal for use as a wrong-type argument where numeric is expected. */
  const stringLiteralArb = alphaStringArb(1, 6, ALNUM).map(s => `'${s}'`);

  /** Numeric literal for use as a wrong-type argument where string is expected. */
  const numericLiteralArb = fc.integer({ min: 0, max: 9999 }).map(n => String(n));

  /**
   * Generator: pick a known function with typed params, then generate a call
   * with the correct number of args but with the WRONG type at one typed position.
   *
   * - If param expects 'string', provide a numeric literal (e.g., '42')
   * - If param expects 'numeric', provide a string literal (e.g., "'hello'")
   * - Other positions get correct-type args
   */
  const wrongParamTypeCallArb = fc
    .constantFrom(...typedSigEntries)
    .chain(({ sig, typedPositions }) => {
      // Pick one typed position to violate
      const posArb = fc.constantFrom(...typedPositions);
      const lineArb = fc.integer({ min: 1, max: 500 });

      return fc.tuple(posArb, lineArb, stringLiteralArb, numericLiteralArb).map(
        ([targetPos, line, strLit, numLit]) => {
          // Determine arg count: use minParams (or maxParams if finite and equal)
          const argCount = Math.max(sig.minParams, targetPos.index + 1);

          const args: string[] = [];
          for (let i = 0; i < argCount; i++) {
            if (i === targetPos.index) {
              // Provide the WRONG type
              args.push(targetPos.type === 'string' ? numLit : strLit);
            } else {
              // Provide a correct-type arg (or 'any'-compatible)
              const paramType = i < sig.params.length ? sig.params[i].type : 'any';
              if (paramType === 'string' || paramType === 'any') {
                args.push(strLit);
              } else {
                args.push(numLit);
              }
            }
          }

          const call: TiFunctionCall = {
            type: 'functionCall',
            name: sig.name,
            args,
            line,
          };

          return { call, sigName: sig.name, violatedIndex: targetPos.index };
        },
      );
    });

  it('reports wrong-param-type when a known function receives a wrong-type argument at a typed position', () => {
    fc.assert(
      fc.property(wrongParamTypeCallArb, ({ call }) => {
        const ast = [call];
        const diagnostics = lintTiAst(ast);

        const wrongTypeDiags = diagnostics.filter(d => d.ruleId === 'wrong-param-type');
        expect(wrongTypeDiags.length).toBeGreaterThanOrEqual(1);
        expect(wrongTypeDiags[0].line).toBe(call.line);
        expect(wrongTypeDiags[0].severity).toBe('error');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 7: unused variables ─────────────────────────────────────

// Feature: ti-linter, Property 7: unused variables
describe('Property 7: unused variables', () => {
  // **Validates: Requirements 3.1**

  /**
   * Generate an AST with a single assignment to a variable that is never
   * read anywhere — no expression, condition, or function argument references it.
   *
   * Strategy:
   * - Pick a variable name that doesn't collide with known function names or bare keywords
   * - Create a single assignment (string or numeric literal)
   * - The AST is just [assignment] — no other statements reference the variable
   * - The linter should report 'unused-variable' for that assignment line
   */
  const BARE_KW = new Set([
    'itemskip', 'itemreject', 'processquit', 'processerror', 'processbreak', 'processabort',
  ]);

  const unusedVarAssignmentArb = fc.tuple(
    varNameArb.filter(name => {
      const lower = name.toLowerCase();
      return !KNOWN_SIGNATURES.has(lower) && !BARE_KW.has(lower);
    }),
    fc.boolean(), // true = string literal, false = numeric literal
    fc.integer({ min: 1, max: 500 }), // line number
  ).map(([varName, isString, line]): { assignment: TiAssignment; line: number } => {
    const expression = isString ? `'somevalue'` : '42';
    return {
      assignment: {
        type: 'assignment',
        variable: varName,
        expression,
        isExternal: false,
        line,
      },
      line,
    };
  });

  it('reports unused-variable when a variable is assigned but never read', () => {
    fc.assert(
      fc.property(unusedVarAssignmentArb, ({ assignment, line }) => {
        const ast = [assignment];
        const diagnostics = lintTiAst(ast);

        const unusedDiags = diagnostics.filter(d => d.ruleId === 'unused-variable');
        expect(unusedDiags.length).toBeGreaterThanOrEqual(1);
        expect(unusedDiags[0].line).toBe(line);
        expect(unusedDiags[0].severity).toBe('hint');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 8: Dead Store ───────────────────────────────────────────

// Feature: ti-linter, Property 8: Dead Store
describe('Property 8: Dead Store', () => {
  // **Validates: Requirements 3.2**

  /**
   * Generate an AST with THREE consecutive assignments to the SAME variable,
   * with NO read of that variable between them.
   * The first assignment is the initialization (not a dead store).
   * The second assignment overwrites the first without reading → dead-store on line of SECOND assignment.
   * The third assignment overwrites the second without reading → dead-store on line of SECOND assignment.
   *
   * We check that at least one dead-store is reported (for the second assignment).
   */
  const BARE_KW = new Set([
    'itemskip', 'itemreject', 'processquit', 'processerror', 'processbreak', 'processabort',
  ]);

  const deadStoreTripletArb = fc.tuple(
    varNameArb.filter(name => {
      const lower = name.toLowerCase();
      return !KNOWN_SIGNATURES.has(lower) && !BARE_KW.has(lower);
    }),
    fc.boolean(), // true = string literal for expr1, false = numeric
    fc.boolean(), // true = string literal for expr2, false = numeric
    fc.boolean(), // true = string literal for expr3, false = numeric
    fc.integer({ min: 1, max: 400 }), // line for first assignment
  ).map(([varName, isString1, isString2, isString3, line1]) => {
    const line2 = line1 + 1;
    const line3 = line1 + 2;
    const expr1 = isString1 ? `'value1'` : '10';
    const expr2 = isString2 ? `'value2'` : '20';
    const expr3 = isString3 ? `'value3'` : '30';

    const assignment1: TiAssignment = {
      type: 'assignment',
      variable: varName,
      expression: expr1,
      isExternal: false,
      line: line1,
    };

    const assignment2: TiAssignment = {
      type: 'assignment',
      variable: varName,
      expression: expr2,
      isExternal: false,
      line: line2,
    };

    const assignment3: TiAssignment = {
      type: 'assignment',
      variable: varName,
      expression: expr3,
      isExternal: false,
      line: line3,
    };

    return { assignment1, assignment2, assignment3, line2 };
  });

  it('reports dead-store when a variable is assigned again without being read (not for initial assignment)', () => {
    fc.assert(
      fc.property(deadStoreTripletArb, ({ assignment1, assignment2, assignment3, line2 }) => {
        const ast = [assignment1, assignment2, assignment3];
        const diagnostics = lintTiAst(ast);

        const deadStoreDiags = diagnostics.filter(d => d.ruleId === 'dead-store');
        expect(deadStoreDiags.length).toBeGreaterThanOrEqual(1);
        // The second assignment (line2) should be flagged as dead-store
        // because it overwrites assignment1 and is then overwritten by assignment3
        expect(deadStoreDiags.some(d => d.line === line2)).toBe(true);
        expect(deadStoreDiags[0].severity).toBe('hint');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 9: empty control structures ─────────────────────────────

// Feature: ti-linter, Property 9: empty control structures
describe('Property 9: empty control structures', () => {
  // **Validates: Requirements 3.3, 3.4**

  /**
   * Generate an empty IF block: thenBody is empty, no elseIfClauses, elseBody is empty.
   * The linter should report 'empty-if' with severity 'hint'.
   */
  const emptyIfBlockArb = fc.tuple(
    // Condition string (simple comparison)
    fc.tuple(varNameArb, comparisonOpArb, fc.integer({ min: 0, max: 999 }).map(String))
      .map(([v, op, n]) => `${v} ${op} ${n}`),
    // Line number
    fc.integer({ min: 1, max: 500 }),
  ).map(([condition, line]): TiIfBlock => ({
    type: 'if',
    condition,
    thenBody: [],
    elseIfClauses: [],
    elseBody: [],
    line,
  }));

  it('reports empty-if when an IF block has empty thenBody, no elseIfClauses, and empty elseBody', () => {
    fc.assert(
      fc.property(emptyIfBlockArb, (ifBlock) => {
        const ast = [ifBlock];
        const diagnostics = lintTiAst(ast);

        const emptyIfDiags = diagnostics.filter(d => d.ruleId === 'empty-if');
        expect(emptyIfDiags.length).toBeGreaterThanOrEqual(1);
        expect(emptyIfDiags[0].line).toBe(ifBlock.line);
        expect(emptyIfDiags[0].severity).toBe('hint');
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Generate an empty WHILE block: body is empty.
   * The linter should report 'empty-while' with severity 'hint'.
   */
  const emptyWhileBlockArb = fc.tuple(
    // Condition string (simple comparison)
    fc.tuple(varNameArb, comparisonOpArb, fc.integer({ min: 0, max: 999 }).map(String))
      .map(([v, op, n]) => `${v} ${op} ${n}`),
    // Line number
    fc.integer({ min: 1, max: 500 }),
  ).map(([condition, line]): TiWhileBlock => ({
    type: 'while',
    condition,
    body: [],
    line,
  }));

  it('reports empty-while when a WHILE block has an empty body', () => {
    fc.assert(
      fc.property(emptyWhileBlockArb, (whileBlock) => {
        const ast = [whileBlock];
        const diagnostics = lintTiAst(ast);

        const emptyWhileDiags = diagnostics.filter(d => d.ruleId === 'empty-while');
        expect(emptyWhileDiags.length).toBeGreaterThanOrEqual(1);
        expect(emptyWhileDiags[0].line).toBe(whileBlock.line);
        expect(emptyWhileDiags[0].severity).toBe('hint');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 11: unknown function ────────────────────────────────────

// Feature: ti-linter, Property 11: unknown function
describe('Property 11: unknown function', () => {
  // **Validates: Requirements 4.2**

  /**
   * Bare keywords that are valid TI statements but not real function calls.
   * These should NOT trigger 'unknown-function'.
   */
  const BARE_KW = new Set([
    'itemskip', 'itemreject', 'processquit', 'processerror', 'processbreak', 'processabort',
  ]);

  /**
   * Generate function calls with names NOT in KNOWN_SIGNATURES and NOT bare keywords.
   *
   * Strategy:
   * - Generate a valid identifier (starts with letter, alphanumeric)
   * - Filter out any name that matches a known function (case-insensitive)
   * - Filter out any name that matches a bare keyword (case-insensitive)
   * - Generate 0-3 arbitrary string arguments
   * - The linter should report 'unknown-function' with severity 'hint'
   */
  const unknownFunctionCallArb = fc.tuple(
    fc.tuple(
      fc.constantFrom(...LOWER.split('')),
      alphaStringArb(2, 8, ALNUM),
    ).map(([first, rest]) => first + rest)
      .filter(name => {
        const lower = name.toLowerCase();
        return !KNOWN_SIGNATURES.has(lower) && !BARE_KW.has(lower);
      }),
    fc.array(
      alphaStringArb(1, 6, ALNUM).map(s => `'${s}'`),
      { minLength: 0, maxLength: 3 },
    ),
    fc.integer({ min: 1, max: 500 }),
  ).map(([funcName, args, line]): TiFunctionCall => ({
    type: 'functionCall',
    name: funcName,
    args,
    line,
  }));

  it('reports unknown-function when a function name is not in KNOWN_SIGNATURES and not a bare keyword', () => {
    fc.assert(
      fc.property(unknownFunctionCallArb, (call) => {
        const ast = [call];
        const diagnostics = lintTiAst(ast);

        const unknownFnDiags = diagnostics.filter(d => d.ruleId === 'unknown-function');
        expect(unknownFnDiags.length).toBeGreaterThanOrEqual(1);
        expect(unknownFnDiags[0].line).toBe(call.line);
        expect(unknownFnDiags[0].severity).toBe('hint');
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 1: structural validity of all diagnostics ───────────────

// Feature: ti-linter, Property 1: structural validity of all diagnostics
describe('Property 1: structural validity of all diagnostics', () => {
  // **Validates: Requirements 1.1, 1.2, 7.1**

  const VALID_RULE_IDS = new Set([
    'endless-loop',
    'wrong-arg-count',
    'string-compare-without-at',
    'numeric-compare-with-at',
    'type-mismatch-assignment',
    'wrong-param-type',
    'unused-variable',
    'dead-store',
    'empty-if',
    'empty-while',
    'cellput-no-error-handling',
    'unknown-function',
    'missing-semicolon',
    'wrong-section',
    'dead-code-condition',
    'tm1-error-code',
    'performance-hint',
    'hardcoded-path',
    'expand-missing',
    'non-ascii-identifier',
    'exec-command-forbidden',
    'process-call-not-literal',
    'processquit-unreachable',
    'readonly-param-write',
    'odbc-password-not-param',
    'var-naming-prefix',
    'param-naming-prefix',
    'datasource-var-naming',
    'missing-docstring',
    'invalid-object-name',
    'comment-before-if',
    'comment-before-while',
    'cube-logging-not-restored',
    'temp-object-not-destroyed',
    'executeprocess-return-ignored',
    'recursive-process-call',
    'cellget-in-loop-constant',
    'element-write-before-commit',
    'ascii-output-overwrite',
  ]);

  /** String literal: single-quoted text. */
  const stringLiteralArb = alphaStringArb(1, 6, ALNUM).map(s => `'${s}'`);

  /** Numeric literal: positive integers. */
  const numericLiteralArb = fc.integer({ min: 0, max: 9999 }).map(n => String(n));

  /** Simple expression: variable, string literal, or numeric literal. */
  const simpleExprArb = fc.oneof(varNameArb, stringLiteralArb, numericLiteralArb);

  /** Condition string: operand op operand. */
  const conditionArb = fc.tuple(
    simpleExprArb,
    comparisonOpArb,
    simpleExprArb,
  ).map(([left, op, right]) => `${left} ${op} ${right}`);

  /** Known function names for generating realistic function calls. */
  const knownFuncNames = [...KNOWN_SIGNATURES.keys()].slice(0, 20);

  /** Function name: either known or arbitrary. */
  const funcNameArb = fc.oneof(
    knownFuncNames.length > 0
      ? fc.constantFrom(...knownFuncNames).map(k => KNOWN_SIGNATURES.get(k)!.name)
      : varNameArb,
    varNameArb,
  );

  /** Line number. */
  const lineArb = fc.integer({ min: 1, max: 500 });

  /** Assignment arbitrary. */
  const assignmentArb: fc.Arbitrary<TiAssignment> = fc.tuple(
    varNameArb,
    simpleExprArb,
    fc.boolean(),
    lineArb,
  ).map(([variable, expression, _isExternal, line]) => ({
    type: 'assignment' as const,
    variable,
    expression,
    isExternal: false,
    line,
  }));

  /** Function call arbitrary. */
  const functionCallArb: fc.Arbitrary<TiFunctionCall> = fc.tuple(
    funcNameArb,
    fc.array(simpleExprArb, { minLength: 0, maxLength: 4 }),
    lineArb,
  ).map(([name, args, line]) => ({
    type: 'functionCall' as const,
    name,
    args,
    line,
  }));

  /** Leaf statement: assignment or function call. */
  const leafStmtArb: fc.Arbitrary<TiStatement> = fc.oneof(assignmentArb, functionCallArb);

  /** Statement arbitrary with bounded nesting depth. */
  function stmtArb(maxDepth: number): fc.Arbitrary<TiStatement> {
    if (maxDepth <= 0) {
      return leafStmtArb;
    }
    const bodyArb = fc.array(stmtArb(maxDepth - 1), { minLength: 0, maxLength: 3 });

    const ifArb: fc.Arbitrary<TiIfBlock> = fc.tuple(
      conditionArb,
      bodyArb,
      fc.array(
        fc.tuple(conditionArb, bodyArb, lineArb),
        { minLength: 0, maxLength: 2 },
      ),
      fc.oneof(fc.constant([] as TiStatement[]), bodyArb),
      lineArb,
    ).map(([condition, thenBody, elseIfs, elseBody, line]) => ({
      type: 'if' as const,
      condition,
      thenBody,
      elseIfClauses: elseIfs.map(([c, b, l]) => ({ condition: c, body: b, line: l })),
      elseBody,
      line,
    }));

    const whileArb: fc.Arbitrary<TiWhileBlock> = fc.tuple(
      conditionArb,
      bodyArb,
      lineArb,
    ).map(([condition, body, line]) => ({
      type: 'while' as const,
      condition,
      body,
      line,
    }));

    return fc.oneof(
      { weight: 3, arbitrary: leafStmtArb },
      { weight: 2, arbitrary: ifArb },
      { weight: 1, arbitrary: whileArb },
    );
  }

  /** Arbitrary valid TiAst with bounded depth. */
  const tiAstArb = fc.array(stmtArb(2), { minLength: 0, maxLength: 6 });

  it('every LintDiagnose has line >= 1, valid severity, valid ruleId, and message starts with [ruleId]', () => {
    fc.assert(
      fc.property(tiAstArb, (ast) => {
        const diagnostics = lintTiAst(ast);

        for (const d of diagnostics) {
          expect(d.line).toBeGreaterThanOrEqual(1);
          expect(['error', 'warning', 'hint', 'info']).toContain(d.severity);
          expect(VALID_RULE_IDS.has(d.ruleId)).toBe(true);
          // A diagnostic carries either a baked `message` prefixed with [ruleId]
          // (legacy/untouched rules) or a localizable `messageKey` (converted rules).
          if (d.messageKey !== undefined) {
            expect(typeof d.messageKey).toBe('string');
          } else {
            expect(d.message!.startsWith(`[${d.ruleId}]`)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ── Property 12: diagnostic messages contain referenced names ────────

// Feature: ti-linter, Property 12: diagnostic messages contain referenced names
describe('Property 12: diagnostic messages contain referenced names', () => {
  // **Validates: Requirements 7.3**

  const BARE_KW = new Set([
    'itemskip', 'itemreject', 'processquit', 'processerror', 'processbreak', 'processabort',
  ]);

  /** Variable name that doesn't collide with known functions or bare keywords. */
  const safeVarNameArb = varNameArb.filter(name => {
    const lower = name.toLowerCase();
    return !KNOWN_SIGNATURES.has(lower) && !BARE_KW.has(lower);
  });

  it('unused-variable message contains the variable name', () => {
    fc.assert(
      fc.property(
        safeVarNameArb,
        fc.integer({ min: 1, max: 500 }),
        (varName, line) => {
          const ast: TiStatement[] = [{
            type: 'assignment',
            variable: varName,
            expression: '42',
            isExternal: false,
            line,
          }];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'unused-variable');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain(varName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('dead-store message contains the variable name', () => {
    fc.assert(
      fc.property(
        safeVarNameArb,
        fc.integer({ min: 1, max: 400 }),
        (varName, line1) => {
          // Need 3 assignments: first is init, second is dead-store, third overwrites
          const ast: TiStatement[] = [
            {
              type: 'assignment',
              variable: varName,
              expression: '10',
              isExternal: false,
              line: line1,
            },
            {
              type: 'assignment',
              variable: varName,
              expression: '20',
              isExternal: false,
              line: line1 + 1,
            },
            {
              type: 'assignment',
              variable: varName,
              expression: '30',
              isExternal: false,
              line: line1 + 2,
            },
          ];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'dead-store');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain(varName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('type-mismatch-assignment message contains the variable name', () => {
    fc.assert(
      fc.property(
        safeVarNameArb,
        fc.integer({ min: 1, max: 400 }),
        (varName, line1) => {
          const ast: TiStatement[] = [
            {
              type: 'assignment',
              variable: varName,
              expression: `'hello'`,
              isExternal: false,
              line: line1,
            },
            {
              type: 'assignment',
              variable: varName,
              expression: '42',
              isExternal: false,
              line: line1 + 1,
            },
          ];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'type-mismatch-assignment');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain(varName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('wrong-arg-count message contains the function name', () => {
    // Use TRIM which expects exactly 1 argument
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (line) => {
          const ast: TiStatement[] = [{
            type: 'functionCall',
            name: 'TRIM',
            args: [`'a'`, `'b'`, `'c'`],
            line,
          }];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'wrong-arg-count');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain('TRIM');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('wrong-param-type message contains the function name', () => {
    // TRIM expects a string parameter; pass a numeric literal to trigger wrong-param-type
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (line) => {
          const ast: TiStatement[] = [{
            type: 'functionCall',
            name: 'TRIM',
            args: ['42'],
            line,
          }];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'wrong-param-type');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain('TRIM');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('unknown-function message contains the function name', () => {
    fc.assert(
      fc.property(
        safeVarNameArb.map(n => n.charAt(0).toUpperCase() + n.slice(1) + 'Func'),
        fc.integer({ min: 1, max: 500 }),
        (funcName, line) => {
          // Ensure the generated name is truly unknown
          if (KNOWN_SIGNATURES.has(funcName.toLowerCase()) || BARE_KW.has(funcName.toLowerCase())) {
            return; // skip this case
          }
          const ast: TiStatement[] = [{
            type: 'functionCall',
            name: funcName,
            args: [],
            line,
          }];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'unknown-function');
          expect(diag).toBeDefined();
          expect(String(diag!.messageArgs?.[0])).toContain(funcName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('endless-loop message contains the condition referencing the variable', () => {
    fc.assert(
      fc.property(
        safeVarNameArb,
        fc.integer({ min: 1, max: 500 }),
        (counterVar, line) => {
          const condition = `${counterVar} > 0`;
          const ast: TiStatement[] = [{
            type: 'while',
            condition,
            body: [],
            line,
          }];
          const diagnostics = lintTiAst(ast);
          const diag = diagnostics.find(d => d.ruleId === 'endless-loop');
          expect(diag).toBeDefined();
          // The endless-loop message includes the condition string which contains the variable name
          expect(String(diag!.messageArgs?.[0])).toContain(counterVar);
        },
      ),
      { numRuns: 100 },
    );
  });
});
