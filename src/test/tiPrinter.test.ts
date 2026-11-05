import { printTiAst } from '../tiLogicVisualizer/tiPrinter';
import type {
  TiAst,
} from '../tiLogicVisualizer/types';

// --- Requirement 2.1: Printer converts AST to valid TI code ---

describe('Assignment printing (Req 2.1)', () => {
  it('prints a simple assignment', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'x', expression: '42', isExternal: false, line: 1 },
    ];
    expect(printTiAst(ast)).toBe('x = 42;');
  });

  it('prints a CellGetN assignment (isExternal flag does not affect output)', () => {
    const ast: TiAst = [
      {
        type: 'assignment',
        variable: 'vValue',
        expression: "CellGetN('cube', 'dim1', 'elem1')",
        isExternal: true,
        cellGetInfo: { fn: 'CellGetN', params: ["'cube'", "'dim1'", "'elem1'"] },
        line: 1,
      },
    ];
    expect(printTiAst(ast)).toBe("vValue = CellGetN('cube', 'dim1', 'elem1');");
  });

  it('prints multiple assignments', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'a', expression: '1', isExternal: false, line: 1 },
      { type: 'assignment', variable: 'b', expression: '2', isExternal: false, line: 2 },
    ];
    expect(printTiAst(ast)).toBe('a = 1;\nb = 2;');
  });
});

describe('IF block printing (Req 2.1)', () => {
  it('prints a simple IF/ENDIF block', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'x > 0',
        thenBody: [
          { type: 'assignment', variable: 'y', expression: '1', isExternal: false, line: 2 },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const expected = [
      'IF(x > 0);',
      '  y = 1;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('prints IF/ELSE/ENDIF block', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'a = 1',
        thenBody: [
          { type: 'assignment', variable: 'x', expression: '10', isExternal: false, line: 2 },
        ],
        elseIfClauses: [],
        elseBody: [
          { type: 'assignment', variable: 'x', expression: '20', isExternal: false, line: 4 },
        ],
        line: 1,
      },
    ];
    const expected = [
      'IF(a = 1);',
      '  x = 10;',
      'ELSE;',
      '  x = 20;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('prints IF/ELSEIF/ELSE/ENDIF block', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'a > 10',
        thenBody: [
          { type: 'assignment', variable: 'x', expression: '1', isExternal: false, line: 2 },
        ],
        elseIfClauses: [
          {
            condition: 'a > 5',
            body: [
              { type: 'assignment', variable: 'x', expression: '2', isExternal: false, line: 4 },
            ],
            line: 3,
          },
        ],
        elseBody: [
          { type: 'assignment', variable: 'x', expression: '3', isExternal: false, line: 6 },
        ],
        line: 1,
      },
    ];
    const expected = [
      'IF(a > 10);',
      '  x = 1;',
      'ELSEIF(a > 5);',
      '  x = 2;',
      'ELSE;',
      '  x = 3;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('prints IF with empty then body', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'flag',
        thenBody: [],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const expected = [
      'IF(flag);',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });
});

describe('WHILE block printing (Req 2.1)', () => {
  it('prints a simple WHILE/END loop', () => {
    const ast: TiAst = [
      {
        type: 'while',
        condition: 'i < 10',
        body: [
          { type: 'assignment', variable: 'i', expression: 'i + 1', isExternal: false, line: 2 },
        ],
        line: 1,
      },
    ];
    const expected = [
      'WHILE(i < 10);',
      '  i = i + 1;',
      'END;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('prints WHILE with empty body', () => {
    const ast: TiAst = [
      { type: 'while', condition: '1 = 1', body: [], line: 1 },
    ];
    const expected = [
      'WHILE(1 = 1);',
      'END;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });
});

describe('Function call printing (Req 2.1)', () => {
  it('prints a function call with arguments', () => {
    const ast: TiAst = [
      { type: 'functionCall', name: 'CellPutN', args: ['42', "'cube'", "'dim1'"], line: 1 },
    ];
    expect(printTiAst(ast)).toBe("CellPutN(42, 'cube', 'dim1');");
  });

  it('prints a function call with no arguments', () => {
    const ast: TiAst = [
      { type: 'functionCall', name: 'ProcessBreak', args: [], line: 1 },
    ];
    expect(printTiAst(ast)).toBe('ProcessBreak();');
  });
});

describe('Nested structures and indentation (Req 2.1)', () => {
  it('indents nested IF inside IF', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'a > 0',
        thenBody: [
          {
            type: 'if',
            condition: 'b > 0',
            thenBody: [
              { type: 'assignment', variable: 'x', expression: '1', isExternal: false, line: 3 },
            ],
            elseIfClauses: [],
            elseBody: [
              { type: 'assignment', variable: 'x', expression: '2', isExternal: false, line: 5 },
            ],
            line: 2,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const expected = [
      'IF(a > 0);',
      '  IF(b > 0);',
      '    x = 1;',
      '  ELSE;',
      '    x = 2;',
      '  ENDIF;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('indents WHILE inside IF', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'flag = 1',
        thenBody: [
          {
            type: 'while',
            condition: 'i < 5',
            body: [
              { type: 'assignment', variable: 'i', expression: 'i + 1', isExternal: false, line: 3 },
            ],
            line: 2,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const expected = [
      'IF(flag = 1);',
      '  WHILE(i < 5);',
      '    i = i + 1;',
      '  END;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('indents IF inside WHILE', () => {
    const ast: TiAst = [
      {
        type: 'while',
        condition: 'i < 10',
        body: [
          {
            type: 'if',
            condition: 'i > 5',
            thenBody: [
              { type: 'assignment', variable: 'x', expression: '1', isExternal: false, line: 3 },
            ],
            elseIfClauses: [],
            elseBody: [],
            line: 2,
          },
          { type: 'assignment', variable: 'i', expression: 'i + 1', isExternal: false, line: 5 },
        ],
        line: 1,
      },
    ];
    const expected = [
      'WHILE(i < 10);',
      '  IF(i > 5);',
      '    x = 1;',
      '  ENDIF;',
      '  i = i + 1;',
      'END;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });

  it('handles three levels of nesting', () => {
    const ast: TiAst = [
      {
        type: 'if',
        condition: 'a',
        thenBody: [
          {
            type: 'while',
            condition: 'b',
            body: [
              {
                type: 'if',
                condition: 'c',
                thenBody: [
                  { type: 'functionCall', name: 'DoSomething', args: [], line: 4 },
                ],
                elseIfClauses: [],
                elseBody: [],
                line: 3,
              },
            ],
            line: 2,
          },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 1,
      },
    ];
    const expected = [
      'IF(a);',
      '  WHILE(b);',
      '    IF(c);',
      '      DoSomething();',
      '    ENDIF;',
      '  END;',
      'ENDIF;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });
});

describe('Edge cases (Req 2.1)', () => {
  it('prints empty AST as empty string', () => {
    expect(printTiAst([])).toBe('');
  });

  it('prints mixed top-level statements', () => {
    const ast: TiAst = [
      { type: 'assignment', variable: 'x', expression: '1', isExternal: false, line: 1 },
      { type: 'functionCall', name: 'LogOutput', args: ["'INFO'", "'start'"], line: 2 },
      {
        type: 'if',
        condition: 'x > 0',
        thenBody: [
          { type: 'assignment', variable: 'y', expression: '2', isExternal: false, line: 4 },
        ],
        elseIfClauses: [],
        elseBody: [],
        line: 3,
      },
      {
        type: 'while',
        condition: 'i < 3',
        body: [
          { type: 'assignment', variable: 'i', expression: 'i + 1', isExternal: false, line: 7 },
        ],
        line: 6,
      },
    ];
    const expected = [
      'x = 1;',
      "LogOutput('INFO', 'start');",
      'IF(x > 0);',
      '  y = 2;',
      'ENDIF;',
      'WHILE(i < 3);',
      '  i = i + 1;',
      'END;',
    ].join('\n');
    expect(printTiAst(ast)).toBe(expected);
  });
});
