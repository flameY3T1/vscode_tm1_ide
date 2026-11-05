import { describe, it, expect } from 'vitest';
import {
  lintRules,
  lintRulesServer,
  extractBracketRefs,
  validateBracketRefSyntax,
  parseBracketDimRefs,
  extractDbCalls,
} from '../tiLogicVisualizer/rulesLinter';
import type { ApiRequestFn } from '../tiLogicVisualizer/rulesLinter';

// ─── extractBracketRefs ───────────────────────────────────────────────────────

describe('extractBracketRefs', () => {
  it('extracts a single ref', () => {
    expect(extractBracketRefs("['Dim':'Elem']")).toEqual(["'Dim':'Elem'"]);
  });

  it('extracts multiple refs from one line', () => {
    expect(extractBracketRefs("['D1':'E1'] + ['D2':'E2']")).toEqual(["'D1':'E1'", "'D2':'E2'"]);
  });

  it('ignores brackets inside a quoted string', () => {
    expect(extractBracketRefs("STR('[not a ref]', 10, 0)")).toEqual([]);
  });

  it('ignores brackets in a comment', () => {
    expect(extractBracketRefs("N: 1; # ['Comment':'Here']")).toEqual([]);
  });

  it('returns empty for a line without brackets', () => {
    expect(extractBracketRefs("N: 1 + 2;")).toEqual([]);
  });

  it('handles multi-dim ref', () => {
    const refs = extractBracketRefs("['D1':'E1','D2':'E2']");
    expect(refs).toEqual(["'D1':'E1','D2':'E2'"]);
  });
});

// ─── validateBracketRefSyntax ─────────────────────────────────────────────────

describe('validateBracketRefSyntax', () => {
  it('accepts simple element', () => {
    expect(validateBracketRefSyntax("'Dim':'Elem'")).toBeNull();
  });

  it('accepts multi-element set', () => {
    expect(validateBracketRefSyntax("'Dim':{'E1','E2'}")).toBeNull();
  });

  it('accepts multi-element set with spaces', () => {
    expect(validateBracketRefSyntax("'Dim':{ 'E1' , 'E2' }")).toBeNull();
  });

  it('accepts multiple dimensions', () => {
    expect(validateBracketRefSyntax("'D1':'E1','D2':'E2'")).toBeNull();
  });

  it('accepts empty content (TM1 wildcard for all cells)', () => {
    expect(validateBracketRefSyntax('')).toBeNull();
  });

  it('flags a quoted name without a colon (unqualified element)', () => {
    expect(validateBracketRefSyntax("'Dim'")).not.toBeNull();
  });

  it('rejects unquoted dim:elem', () => {
    // no quotes → treated as dynamic ref → null (skip)
    expect(validateBracketRefSyntax('Dim:Elem')).toBeNull();
  });

  it('treats dynamic refs without quotes as valid (no check)', () => {
    expect(validateBracketRefSyntax('!Year')).toBeNull();
  });

  it('rejects partially quoted — dim quoted, elem unquoted', () => {
    expect(validateBracketRefSyntax("'Dim':Elem")).not.toBeNull();
  });

  it('accepts 3-part dim:hier:elem', () => {
    expect(validateBracketRefSyntax("'Konten':'Leaves':'VZP'")).toBeNull();
  });

  it('accepts 3-part dim:hier:set', () => {
    expect(validateBracketRefSyntax("'Konten':'Leaves':{'E1','E2'}")).toBeNull();
  });

  it('accepts mixed 2-part and 3-part across dimensions', () => {
    expect(validateBracketRefSyntax("'Konten':'Leaves':'VZP','Version':'Actual'")).toBeNull();
  });

  it('rejects 3-part with unquoted element', () => {
    expect(validateBracketRefSyntax("'Dim':'Hier':Elem")).not.toBeNull();
  });
});

// ─── parseBracketDimRefs ──────────────────────────────────────────────────────

describe('parseBracketDimRefs', () => {
  it('parses single dim:elem', () => {
    const refs = parseBracketDimRefs("'Month':'Jan'");
    expect(refs).toEqual([{ dim: 'Month', elems: ['Jan'] }]);
  });

  it('parses multi-element set', () => {
    const refs = parseBracketDimRefs("'Month':{'Jan','Feb'}");
    expect(refs).toEqual([{ dim: 'Month', elems: ['Jan', 'Feb'] }]);
  });

  it('parses multiple dimensions', () => {
    const refs = parseBracketDimRefs("'Month':'Jan','Version':'Actual'");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ dim: 'Month', elems: ['Jan'] });
    expect(refs[1]).toEqual({ dim: 'Version', elems: ['Actual'] });
  });

  it('returns empty for dynamic ref', () => {
    expect(parseBracketDimRefs('!Year')).toEqual([]);
  });

  it('captures hierarchy + real element (3-part)', () => {
    const refs = parseBracketDimRefs("'Konten':'Leaves':'VZP'");
    expect(refs).toEqual([{ dim: 'Konten', hier: 'Leaves', elems: ['VZP'] }]);
  });

  it('captures hierarchy for 3-part set', () => {
    const refs = parseBracketDimRefs("'Konten':'Leaves':{'E1','E2'}");
    expect(refs).toEqual([{ dim: 'Konten', hier: 'Leaves', elems: ['E1', 'E2'] }]);
  });
});

// ─── extractDbCalls ───────────────────────────────────────────────────────────

describe('extractDbCalls', () => {
  it('extracts a valid call', () => {
    const calls = extractDbCalls("N: DB('MyCube','Jan','Actual');");
    expect(calls).toHaveLength(1);
    expect(calls[0].cubeName).toBe('MyCube');
    expect(calls[0].args).toHaveLength(3);
  });

  it('handles empty DB()', () => {
    const calls = extractDbCalls('DB()');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toHaveLength(0);
    expect(calls[0].cubeName).toBeNull();
  });

  it('sets cubeName to null for non-literal first arg', () => {
    const calls = extractDbCalls("DB(CubeName,'Jan')");
    expect(calls[0].cubeName).toBeNull();
  });

  it('ignores DB() inside a comment', () => {
    expect(extractDbCalls('# DB()')).toHaveLength(0);
  });

  it('extracts multiple calls on one line', () => {
    const calls = extractDbCalls("DB('C1','x') + DB('C2','y')");
    expect(calls).toHaveLength(2);
    expect(calls[0].cubeName).toBe('C1');
    expect(calls[1].cubeName).toBe('C2');
  });

  it('handles DB() inside a string gracefully', () => {
    // The string 'DB(test)' should not be extracted as a call
    const calls = extractDbCalls("STR('DB(test)', 10, 0)");
    expect(calls).toHaveLength(0);
  });
});

// ─── lintRules — DB() static checks ─────────────────────────────────────────

describe('lintRules — DB() static checks', () => {
  it('error: DB() with no args', () => {
    const diags = lintRules("N: DB();\nFEEDERS;\n");
    const d = diags.find(d => d.ruleId === 'db-too-few-args');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('error: DB() with only cube name', () => {
    const diags = lintRules("N: DB('Cube');\nFEEDERS;\n");
    expect(diags.some(d => d.ruleId === 'db-too-few-args')).toBe(true);
  });

  it('error: DB() first arg not a string literal', () => {
    const diags = lintRules("N: DB(CubeName,'x','y');\nFEEDERS;\n");
    const d = diags.find(d => d.ruleId === 'db-invalid-cube-arg');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('hint not error: DB() first arg is a function call (conditional cube name, may be intentional)', () => {
    const diags = lintRules("N: ['D1':'E1'] = N: DB(IF(4=1,'C',''),'x','y');\nFEEDERS;\n");
    expect(diags.some(d => d.ruleId === 'db-invalid-cube-arg')).toBe(false);
    const d = diags.find(d => d.ruleId === 'db-conditional-cube-arg');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('hint');
  });

  it('no error: valid DB() call', () => {
    const diags = lintRules("N: ['D1':'E1'] = N: DB('Cube','x','y');\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'db-too-few-args' || d.ruleId === 'db-invalid-cube-arg')).toHaveLength(0);
  });

  it('no false positive: DB in comment', () => {
    const diags = lintRules("# DB()\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'db-too-few-args')).toHaveLength(0);
  });

  it('no false positive: DB() in string', () => {
    const diags = lintRules("N: STR('DB(x)', 10, 0);\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'db-too-few-args')).toHaveLength(0);
  });
});

// ─── lintRules — bracket syntax checks ───────────────────────────────────────

describe('lintRules — bracket syntax checks', () => {
  it('accepts empty brackets [] as wildcard for all cells', () => {
    const diags = lintRules("[] = 1;\nFEEDERS;\n");
    const d = diags.find(d => d.ruleId === 'invalid-cell-ref-syntax');
    expect(d).toBeUndefined();
  });

  it('hint: element named without its dimension gets its own rule id', () => {
    const diags = lintRules("['Dim']\nFEEDERS;\n");
    expect(diags.some(d => d.ruleId === 'unqualified-cell-ref')).toBe(true);
    // Not the syntax-error id — an unqualified name is valid TM1, only ambiguous.
    expect(diags.some(d => d.ruleId === 'invalid-cell-ref-syntax')).toBe(false);
  });

  it('hint: a genuinely malformed ref keeps the syntax-error rule id', () => {
    const diags = lintRules("['Dim':]\nFEEDERS;\n");
    expect(diags.some(d => d.ruleId === 'invalid-cell-ref-syntax')).toBe(true);
  });

  it('no hint: valid simple ref', () => {
    const diags = lintRules("N: ['D':'E'] = N: 1;\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'invalid-cell-ref-syntax')).toHaveLength(0);
  });

  it('no hint: valid multi-element ref', () => {
    const diags = lintRules("N: ['D':{'E1','E2'}] = N: 1;\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'invalid-cell-ref-syntax')).toHaveLength(0);
  });

  it('no false positive: bracket in comment', () => {
    const diags = lintRules("# ['Dim']\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'invalid-cell-ref-syntax')).toHaveLength(0);
  });

  it('no false positive: dynamic ref without quotes', () => {
    // [!Year] or [Year] — skip (no quotes)
    const diags = lintRules("[!Year]\nFEEDERS;\n");
    expect(diags.filter(d => d.ruleId === 'invalid-cell-ref-syntax')).toHaveLength(0);
  });
});

// ─── lintRulesServer — DB() arg count ────────────────────────────────────────

describe('lintRulesServer — DB() arg count', () => {
  it('error: too few args for cube dimensions', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Cubes')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'D1' }, { Name: 'D2' }, { Name: 'D3' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['D':'E'] = N: DB('MyCube','Jan');\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'db-arg-count-mismatch');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('no error: correct arg count', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Cubes')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'D1' }, { Name: 'D2' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['D':'E'] = N: DB('MyCube','Jan','Feb');\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'db-arg-count-mismatch')).toHaveLength(0);
  });

  it('warning: cube not found on server', async () => {
    const api: ApiRequestFn = async () => ({ statusCode: 404, body: '' });
    const diags = await lintRulesServer("N: ['D':'E'] = N: DB('NoSuchCube','x','y');\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'db-unknown-cube');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
  });

  it('returns [] silently when server unreachable', async () => {
    const api: ApiRequestFn = async () => { throw new Error('ECONNREFUSED'); };
    const diags = await lintRulesServer("N: ['D':'E'] = N: DB('Cube','x','y');\nFEEDERS;\n", api);
    expect(diags).toEqual([]);
  });
});

// ─── lintRulesServer — element existence ─────────────────────────────────────

describe('lintRulesServer — element existence', () => {
  it('hint: element not found in dimension', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Jan' }, { Name: 'Feb' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['Month':'NoSuchMonth'] = N: 1;\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'element-not-found');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
  });

  it('no hint: element exists (case-insensitive)', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'January' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['Month':'january'] = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'element-not-found')).toHaveLength(0);
  });

  it('no hint: element matched whitespace-insensitively', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Jan 2024' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['Month':'Jan2024'] = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'element-not-found')).toHaveLength(0);
  });

  it('no hint: alias reference accepted (Attributes string value)', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            value: [{ Name: '0001', Attributes: { Alias: 'Cost Center A', Code: 42 } }],
          }),
        };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['Month':'Cost Center A'] = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'element-not-found')).toHaveLength(0);
  });

  it('warning: dimension not found on server', async () => {
    const api: ApiRequestFn = async () => ({ statusCode: 404, body: '' });
    const diags = await lintRulesServer("N: ['NoSuchDim':'Elem'] = N: 1;\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'dimension-not-found');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  it('fetches each unique dimension only once (cache)', async () => {
    let fetchCount = 0;
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) { fetchCount++; }
      return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Jan' }] }) };
    };
    const text = [
      "N: ['Month':'Jan'] = N: 1;",
      "N: ['Month':'Feb'] = N: 2;",
      "N: ['Month':'Mar'] = N: 3;",
      'FEEDERS;',
    ].join('\n');
    await lintRulesServer(text, api);
    expect(fetchCount).toBe(1);
  });

  it('checks all elements in a multi-element set', async () => {
    const api: ApiRequestFn = async (_m, path) => {
      if (path.includes('Elements')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Jan' }] }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
    const diags = await lintRulesServer("N: ['Month':{'Jan','NoSuchMonth'}] = N: 1;\nFEEDERS;\n", api);
    const found = diags.filter(d => d.ruleId === 'element-not-found');
    expect(found).toHaveLength(1);
    expect(found[0].messageArgs).toContain('NoSuchMonth');
  });
});

// ─── lintRulesServer — hierarchy (Dim:Hier:Elem) ─────────────────────────────

describe('lintRulesServer — hierarchy existence', () => {
  // Mock-Routing:
  //  …/Hierarchies('H')/Elements → element list   (most specific first)
  //  …/Hierarchies?$select=Name  → hierarchy list
  //  …/Hierarchies('Dim')/Elements (default) → dimension-existence probe
  const makeApi = (hiers: string[], elemsByHier: Record<string, string[]>): ApiRequestFn =>
    async (_m, path) => {
      const hm = path.match(/Hierarchies\('([^']+)'\)\/Elements/);
      if (hm) {
        const hier = decodeURIComponent(hm[1]);
        const elems = elemsByHier[hier] ?? [];
        return { statusCode: 200, body: JSON.stringify({ value: elems.map(n => ({ Name: n })) }) };
      }
      if (/Hierarchies\?\$select=Name/.test(path)) {
        return { statusCode: 200, body: JSON.stringify({ value: hiers.map(n => ({ Name: n })) }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };

  it('error: hierarchy not found', async () => {
    const api = makeApi(['Konten'], { Konten: ['VZP'] });
    const diags = await lintRulesServer("N: ['Konten':'Terst':'VZP'] = N: 1;\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'hierarchy-not-found');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
    expect(d!.messageArgs).toContain('Terst');
  });

  it('no hierarchy hint when hierarchy exists', async () => {
    const api = makeApi(['Konten', 'Leaves'], { Leaves: ['VZP'] });
    const diags = await lintRulesServer("N: ['Konten':'Leaves':'VZP'] = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'hierarchy-not-found')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'element-not-found')).toHaveLength(0);
  });

  it('element checked against the named hierarchy (own elements)', async () => {
    // Element 'VZP' lives only in 'Leaves', not in 'Alt'.
    const api = makeApi(['Konten', 'Leaves', 'Alt'], { Leaves: ['VZP'], Alt: ['Other'] });
    const diags = await lintRulesServer("N: ['Konten':'Alt':'VZP'] = N: 1;\nFEEDERS;\n", api);
    const found = diags.filter(d => d.ruleId === 'element-not-found');
    expect(found).toHaveLength(1);
    expect(found[0].messageKey).toContain('hierarchy');
    expect(found[0].messageArgs).toContain('Alt');
  });
});

// ─── lintRulesServer — DB() element existence ────────────────────────────────

describe('lintRulesServer — DB() element existence', () => {
  /**
   * Mock: Cubes('PriceCube')/Dimensions → [D1, D2]
   *       Dimensions('D1')/…/Elements  → [Jan, Feb]
   *       Dimensions('D2')/…/Elements  → [Actual, Budget]
   */
  const makeApi = (cubeExists = true, elemsByDim: Record<string, string[]> = {}): ApiRequestFn =>
    async (_m, path) => {
      if (path.includes('Cubes') && path.includes('Dimensions')) {
        if (!cubeExists) { return { statusCode: 404, body: '' }; }
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'D1' }, { Name: 'D2' }] }) };
      }
      for (const [dim, elems] of Object.entries(elemsByDim)) {
        if (path.includes(`Dimensions('${encodeURIComponent(dim)}')`)) {
          return { statusCode: 200, body: JSON.stringify({ value: elems.map(n => ({ Name: n })) }) };
        }
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };

  it('warning: string-literal arg element not found in DB()', async () => {
    const api = makeApi(true, { D1: ['Jan', 'Feb'], D2: ['Actual', 'Budget'] });
    const diags = await lintRulesServer("N: DB('PriceCube','NoSuchMonth','Actual') = N: 1;\nFEEDERS;\n", api);
    const d = diags.find(d => d.ruleId === 'db-element-not-found');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.messageArgs).toContain('NoSuchMonth');
    expect(d!.messageArgs).toContain('D1');
  });

  it('no warning: all DB() string-literal args valid', async () => {
    const api = makeApi(true, { D1: ['Jan', 'Feb'], D2: ['Actual', 'Budget'] });
    const diags = await lintRulesServer("N: DB('PriceCube','Jan','Actual') = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'db-element-not-found')).toHaveLength(0);
  });

  it('no warning: variable arg (not a string literal) is skipped', async () => {
    const api = makeApi(true, { D1: ['Jan'], D2: ['Actual'] });
    // !Month is a variable — should not be validated
    const diags = await lintRulesServer("N: DB('PriceCube',!Month,'Actual') = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'db-element-not-found')).toHaveLength(0);
  });

  it('no warning when arg count mismatches (db-arg-count-mismatch takes priority)', async () => {
    const api = makeApi(true, { D1: ['Jan'], D2: ['Actual'] });
    // Only 2 args for a 2-dim cube → arg count is wrong (expected 3), element check skipped
    const diags = await lintRulesServer("N: DB('PriceCube','Jan') = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'db-element-not-found')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'db-arg-count-mismatch')).toHaveLength(1);
  });

  it('multiple missing elements reported separately', async () => {
    const api = makeApi(true, { D1: ['Jan', 'Feb'], D2: ['Actual', 'Budget'] });
    const diags = await lintRulesServer("N: DB('PriceCube','NoMonth','NoPlan') = N: 1;\nFEEDERS;\n", api);
    const found = diags.filter(d => d.ruleId === 'db-element-not-found');
    expect(found).toHaveLength(2);
    expect(found.some(d => d.messageArgs?.includes('NoMonth'))).toBe(true);
    expect(found.some(d => d.messageArgs?.includes('NoPlan'))).toBe(true);
  });

  it('case-insensitive element match', async () => {
    const api = makeApi(true, { D1: ['January'], D2: ['Actual'] });
    const diags = await lintRulesServer("N: DB('PriceCube','january','Actual') = N: 1;\nFEEDERS;\n", api);
    expect(diags.filter(d => d.ruleId === 'db-element-not-found')).toHaveLength(0);
  });
});

// ─── lintRules — multi-line continuation ────────────────────────────────────

describe('lintRules — multi-line continuation (no false positives)', () => {
  it('no missing-semicolon on continuation lines inside open parens', () => {
    // Multi-line if() function call — lines 1 and 2 have unclosed parens
    const code = [
      "N: ['D':'E'] = N: if(VALUE_IS_STRING=1, CellPutS(SVALUE,'plan',vVersion,",
      "plan_source,vMonth), CellPutN(NVALUE, 'plan',",
      "plan_source, vMonth));",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('still reports missing-semicolon on a complete line without semicolon', () => {
    const code = "N: ['D':'E'] = N: 1\nFEEDERS;\n";
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(1);
  });

  it('no false positive for feeder continuation lines', () => {
    const code = [
      "FEEDERS;",
      "['D':'E'] => if(condition,",
      "['D':'E1'], ['D':'E2']);",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when expression starts on next line after =N:', () => {
    // The bug case: LHS=N: on one line, DB() expression on following lines
    const code = [
      "[plan_exchange_rates:'local', plan_source:'goal']=N:",
      "DB('plan_BudgetPlan',!plan_version,!plan_business_unit,!plan_department,'actual',",
      "!plan_source,!plan_time) *",
      "DB('plan_ExchangeRate',ATTRS('plan_business_unit',!plan_business_unit,'currency'),'actual',!plan_time);",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when expression starts on next line after =C:', () => {
    const code = [
      "['D':'E'] = C:",
      "['D2':'E2'] + 1;",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon for multi-dim LHS with IF/DB expression spanning 4 lines', () => {
    // Regression: ['Dim1':'E1', 'Dim2':'E2'] = N: followed by IF(DB()@>0, DB(), DB());
    const code = [
      "['Version':'Forecast', 'Kennzahl':'Ist_SWS'] = N:",
      "  IF( DB('Dozentenauslastung', !Semester, !Dozent, !Fakultaet, 'Ist', 'Ist_SWS') @> 0,",
      "    DB('Dozentenauslastung', !Semester, !Dozent, !Fakultaet, 'Ist', 'Ist_SWS'),",
      "    DB('Dozentenauslastung', !Semester, !Dozent, !Fakultaet, 'Plan', 'Plan_SWS') );",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no unclosed-bracket when a cell reference spans two lines', () => {
    // Regression: LHS ref split across a line break, RHS across 4 lines.
    const code = [
      "# AvailableDays = WorkDaysPlanned - VacationDays - SickDays - TrainingDays",
      "['Measure_Capacity':'AvailableDays', ",
      "'Time_Month':'2026_01'] = N:",
      "  ['Measure_Capacity':'WorkDaysPlanned'] -",
      "  ['Measure_Capacity':'VacationDays'] -",
      "  ['Measure_Capacity':'SickDays'] -",
      "  ['Measure_Capacity':'TrainingDays'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'unclosed-bracket')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when a cell reference breaks before the comma', () => {
    // Line break BEFORE the comma: line 1 ends with an element quote, not with an operator.
    const code = [
      "['Measure_Capacity':'AvailableDays'",
      ", 'Time_Month':'2026_01'] = N:",
      "  ['Measure_Capacity':'WorkDaysPlanned'] -",
      "  ['Measure_Capacity':'TrainingDays'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'unclosed-bracket')).toHaveLength(0);
  });

  it('no missing-semicolon when a multi-element ref breaks after the comma', () => {
    const code = [
      "['Measure_Capacity':'AvailableDays', ",
      "'Time_Month':{'2026_01', '2026_02'}] = N:",
      "  ['Measure_Capacity':'WorkDaysPlanned'] -",
      "  ['Measure_Capacity':'TrainingDays'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('still reports unclosed-bracket when bracket stays open until the semicolon', () => {
    const code = "['Dim':'E' = N: 1;\nFEEDERS;\n";
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'unclosed-bracket')).toHaveLength(1);
  });

  it('no missing-semicolon when line ends with backslash continuation', () => {
    const code = [
      "['L / ZEkm_Verbr_Diesel', 'Energie_TLV', 'DS_000', 'Wert'] = C:['Bezug_Diesel_L', 'Energie_TLV'] \\",
      "['ohne Bereichszuordnung', 'ohne FBKB Zuordnung', 'ohne_Vkz_Zuordnung', 'W_1000000', 'FP_Treiber':'ZEkm', 'Energie_TLV'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('backslash continuation works with comment after', () => {
    const code = [
      "['D':'E'] = N: 1 + \\ # continued below",
      "  2;",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('backslash continuation works in feeder section', () => {
    const code = [
      "FEEDERS;",
      "['D':'E'] => \\",
      "  ['D':'F'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when next line starts with backslash (division)', () => {
    const code = [
      "['L / ZEkm', 'Energie_TLV', 'DS_000', 'Wert'] = C:['Bezug_Diesel_L', 'Energie_TLV']",
      "                                              \\ ['ohne Bereichszuordnung', 'Energie_TLV'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when next line starts with minus', () => {
    const code = [
      "['Bereich':'461319','Kennzahl':'h_VZP'] = N: ['ohne_Produktzuordnung', 'h / VZP_Bezahlt']",
      "                                              - ['h / VZP_VertrBedarf'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when next line starts with star (multiplication)', () => {
    const code = [
      "['Bereich':'461319','Kennzahl':'LeistBedarf'] = N: ['indirekte_VZP', 'Trainer_VZP']",
      "                                                 * ['h / VZP_Produktiv'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });

  it('no missing-semicolon when current line ends with binary operator', () => {
    const code = [
      "['D':'E'] = N: ['A':'1'] +",
      "             ['A':'2'];",
      "FEEDERS;",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
  });
});

// ─── lintRules — feeder-db-on-lhs ────────────────────────────────────────────

describe('lintRules — feeder-db-on-lhs', () => {
  it('flags DB() on LHS of single-line feeder', () => {
    const code = [
      "FEEDERS;",
      "DB('Dozentenauslastung', !Sem, !Doz, !Fak, !Ver, 'Ist_SWS') => ['Kennzahl':'Lehrauftragskosten'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(1);
    expect(diags.find(d => d.ruleId === 'feeder-db-on-lhs')?.line).toBe(1);
  });

  it('flags DB() on LHS of multi-line feeder (DB on first line, => on next)', () => {
    const code = [
      "FEEDERS;",
      "DB('Dozentenauslastung', !Semester, !Dozent, !Fakultaet, !Version, 'Ist_SWS')",
      "  => ['Kennzahl':'Lehrauftragskosten'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(1);
    expect(diags.find(d => d.ruleId === 'feeder-db-on-lhs')?.line).toBe(1);
  });

  it('no false positive when DB() is on RHS of feeder', () => {
    const code = [
      "FEEDERS;",
      "['Kennzahl':'Ist_SWS'] => DB('Dozentenauslastung', !Sem, !Doz, !Fak, !Ver, 'Ist_SWS');",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(0);
  });

  it('no false positive when DB() is in RHS of multi-line feeder', () => {
    const code = [
      "FEEDERS;",
      "['Kennzahl':'Ist_SWS']",
      "  => DB('Cube', !Dim1, !Dim2);",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(0);
  });

  it('no missing-semicolon on DB()-LHS line when => is on next line', () => {
    // Regression: DB(...)\n  => [...]; should give feeder-db-on-lhs but NOT missing-semicolon
    const code = [
      "FEEDERS;",
      "DB('Dozentenauslastung', !Semester, !Dozent, !Fakultaet, !Version, 'Ist_SWS')",
      "  => ['Kennzahl':'Lehrauftragskosten'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(1);
  });

  it('no missing-semicolon when valid [..] LHS is on separate line from =>', () => {
    const code = [
      "FEEDERS;",
      "['Kennzahl':'Ist_SWS']",
      "  => ['Kennzahl':'Lehrauftragskosten'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(0);
  });

  it('no diags when => ends LHS line and RHS continues on next line', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] =>",
      "['PK_ValueFields':'Abweichung'], ['PK_ValueFields':'test'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-arrow')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(0);
  });

  it('no diags when RHS continues with comma on indented next line', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] => ['PK_ValueFields':'Abweichung'],",
      "                                    ['PK_ValueFields':'test'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-arrow')).toHaveLength(0);
  });

  it('no diags when RHS DB() calls span multiple lines after =>', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] =>",
      "DB('Projektkosten', !PK_Version, !PK_Projekt, !PK_Kostenart, 'Jan', !PK_ValueFields),",
      "DB('Projektkosten', !PK_Version, !PK_Projekt, !PK_Kostenart, 'Feb', !PK_ValueFields),",
      "DB('Projektkosten', !PK_Version, !PK_Projekt, !PK_Kostenart, 'Dez', !PK_ValueFields);",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-arrow')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'feeder-db-on-lhs')).toHaveLength(0);
  });
});

// ─── lintRules — feeder-missing-comma ────────────────────────────────────────

describe('lintRules — feeder-missing-comma', () => {
  it('flags missing comma between two cell-ref targets on adjacent lines', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] => ['PK_ValueFields':'Abweichung']",
      "                                    ['PK_ValueFields':'test'];",
    ].join('\n');
    const diags = lintRules(code);
    const missing = diags.filter(d => d.ruleId === 'feeder-missing-comma');
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].line).toBe(2);
  });

  it('flags missing comma between two DB() targets on adjacent lines', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] => DB('Cube', !A, !B, 'Jan', !C),",
      "DB('Cube', !A, !B, 'Feb', !C)",
      "DB('Cube', !A, !B, 'Dez', !C);",
    ].join('\n');
    const diags = lintRules(code);
    const missing = diags.filter(d => d.ruleId === 'feeder-missing-comma');
    expect(missing).toHaveLength(1);
    expect(missing[0].line).toBe(3);
  });

  it('no false positive when comma separator IS present at end of line', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] => ['PK_ValueFields':'Abweichung'],",
      "['PK_ValueFields':'test'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-comma')).toHaveLength(0);
  });

  it('no false positive when => ends LHS line and RHS target follows', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual'] =>",
      "['PK_ValueFields':'Abweichung'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-comma')).toHaveLength(0);
  });

  it('flags missing comma between two cell-refs on same line', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual'] =>",
      "['PK_ValueFields':'Abweichung'] ['PK_ValueFields':'test'];",
    ].join('\n');
    const diags = lintRules(code);
    const missing = diags.filter(d => d.ruleId === 'feeder-missing-comma');
    expect(missing).toHaveLength(1);
    expect(missing[0].line).toBe(2);
    expect(missing[0].severity).toBe('error');
  });

  it('flags missing comma between two DB() targets on same line', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual'] => #",
      "DB('Cube', !A, 'Jan', !B) DB('Cube', !A, 'Feb', !B),",
      "DB('Cube', !A, 'Dez', !B);",
    ].join('\n');
    const diags = lintRules(code);
    const missing = diags.filter(d => d.ruleId === 'feeder-missing-comma');
    expect(missing).toHaveLength(1);
    expect(missing[0].line).toBe(2);
  });

  it('no false positive on `] =>` (arrow after target close)', () => {
    const code = [
      "FEEDERS;",
      "['Kennzahl':'Ist_SWS'] => ['X':'Y'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-missing-comma')).toHaveLength(0);
  });
});

// ─── lintRules — feeder-multi-lhs ────────────────────────────────────────────

describe('lintRules — feeder-multi-lhs', () => {
  it('flags two cell-refs on LHS separated by comma', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual'], ['PK_Version':'Plan'] => ['PK_ValueFields':'Abweichung'];",
    ].join('\n');
    const diags = lintRules(code);
    const multi = diags.filter(d => d.ruleId === 'feeder-multi-lhs');
    expect(multi).toHaveLength(1);
    expect(multi[0].severity).toBe('error');
  });

  it('flags two cell-refs on LHS without comma (whitespace only)', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual'] ['PK_Version':'Plan'] => ['PK_ValueFields':'Abweichung'];",
    ].join('\n');
    const diags = lintRules(code);
    const multi = diags.filter(d => d.ruleId === 'feeder-multi-lhs');
    expect(multi).toHaveLength(1);
    // Should NOT also fire feeder-missing-comma in this case (multi-lhs covers it).
    const missing = diags.filter(d => d.ruleId === 'feeder-missing-comma');
    expect(missing).toHaveLength(0);
  });

  it('no flag for single cell-ref LHS', () => {
    const code = [
      "FEEDERS;",
      "['PK_Version':'Actual', 'PK_ValueFields':'Betrag'] => ['PK_ValueFields':'Abweichung'];",
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'feeder-multi-lhs')).toHaveLength(0);
  });
});

// ─── validateBracketRefSyntax — improved hint ────────────────────────────────

describe('validateBracketRefSyntax (improved hint)', () => {
  it('names the offending part when a single dim-spec is malformed', () => {
    const err = validateBracketRefSyntax("'Budget', 'PK_ValueFields':'Betrag'");
    expect(err).not.toBeNull();
    expect(err!.messageArgs).toContain("'Budget'");
    // 'Budget' is unqualified, not malformed — mixing both forms is valid TM1.
    expect(err!.kind).toBe('unqualified');
    expect(err!.messageKey).toMatch(/without its dimension/);
  });

  it('still returns null for valid multi-dim refs', () => {
    expect(validateBracketRefSyntax("'A':'X', 'B':'Y'")).toBeNull();
  });
});

// ─── Semicolon on the following line ─────────────────────────────────────────

describe('Semicolon on its own line', () => {
  it('reports neither missing-semicolon nor parse-error when the `;` sits below the statement', () => {
    const code = [
      'SKIPCHECK;',
      "['Input_Cost','KTO 00100001', 'S00104', 'Datenarten':{'Vorschau', 'Plan'}, 'Wert'] = N:['Menge'] * -DB('zzz_PlanSettings',!Jahre,!Datenarten,!Cost_Accounts,'Wert')",
      '; ',
      'FEEDERS;',
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'parse-error')).toHaveLength(0);
  });

  it('also applies in the FEEDERS section', () => {
    const code = [
      'SKIPCHECK;',
      "['Wert'] = N: 1;",
      'FEEDERS;',
      "['Menge'] => ['Wert']",
      ';',
    ].join('\n');
    const diags = lintRules(code);
    expect(diags.filter(d => d.ruleId === 'missing-semicolon')).toHaveLength(0);
    expect(diags.filter(d => d.ruleId === 'parse-error')).toHaveLength(0);
  });

  it('lets the next statement afterwards be checked normally again', () => {
    const code = [
      'SKIPCHECK;',
      "['Wert'] = N: 1",
      ';',
      "kaputt = 2;",
      'FEEDERS;',
    ].join('\n');
    const diags = lintRules(code);
    // Line 4 (0-based 3) is genuinely broken and must still be flagged.
    expect(diags.filter(d => d.ruleId === 'parse-error').map(d => d.line)).toEqual([3]);
  });
});
