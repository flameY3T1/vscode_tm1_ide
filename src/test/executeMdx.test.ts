import { describe, it, expect } from 'vitest';
import {
  executeMdx, executeMdxContinue, executeMdxAsSet,
  isBareSetMdx, parseFirstDimHier, MDX_CELL_LIMIT,
} from '../mdx/executeMdx';

type ApiResult = { statusCode: number; body: string };
type ApiCall = { method: string; path: string; body?: string };

function makeApi(responses: ApiResult[]): {
  api: (method: string, path: string, body?: string) => Promise<ApiResult>;
  calls: ApiCall[];
} {
  const calls: ApiCall[] = [];
  let i = 0;
  const api = async (method: string, path: string, body?: string) => {
    calls.push({ method, path, body });
    return responses[i++] ?? { statusCode: 500, body: '{}' };
  };
  return { api, calls };
}

describe('executeMdx', () => {
  const mdx = 'SELECT {[Dim].MEMBERS} ON 0 FROM [Cube]';
  const cellsetId = 'abc123';

  it('POSTs MDX, fetches cellset with expand, deletes it, returns parsed table', async () => {
    const cellsetJson = {
      Axes: [
        { Hierarchies: [{ Name: 'Dim' }], Tuples: [{ Members: [{ Name: 'E1' }] }] },
        { Hierarchies: [{ Name: 'Other' }], Tuples: [{ Members: [{ Name: 'All' }] }] },
      ],
      Cells: [{ Ordinal: 0, Value: 42, FormattedValue: '42,00' }],
    };
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '5' },                    // NEW: $count response (< limit)
      { statusCode: 200, body: JSON.stringify(cellsetJson) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
    if (!res.ok) { return; }
    expect(res.table.dims).toEqual({ cols: 1, rows: 1 });
    expect(res.table.cells[0][0]).toEqual({ value: 42, formatted: '42,00' });
    expect(calls).toHaveLength(4);                        // CHANGED: was 3
    expect(calls[0]).toEqual({ method: 'POST', path: 'ExecuteMDX', body: JSON.stringify({ MDX: mdx }) });
    expect(calls[1].method).toBe('GET');
    expect(calls[1].path).toContain('Cells/$count');      // NEW assertion
    expect(calls[2].method).toBe('GET');
    expect(calls[2].path).toContain(`Cellsets('${cellsetId}')`);
    expect(calls[2].path).toContain('$expand=Axes');
    expect(calls[3]).toEqual({ method: 'DELETE', path: `Cellsets('${cellsetId}')`, body: undefined });
  });

  it('returns error from POST /ExecuteMDX without calling GET/DELETE', async () => {
    const { api, calls } = makeApi([
      { statusCode: 400, body: JSON.stringify({ error: { code: '501', message: 'Syntax error' } }) },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
    if (res.ok || res.needsConfirm) { return; }
    expect(res.error.code).toBe('501');
    expect(res.error.message).toBe('Syntax error');
    expect(calls).toHaveLength(1);
  });

  it('extracts error message from the nested `{ value }` shape TM1 also uses', async () => {
    // Regression: the old String(err.message) rendered this shape as
    // "[object Object]". odataErrorMessage now unwraps the value.
    const { api } = makeApi([
      { statusCode: 400, body: JSON.stringify({ error: { code: '777', message: { value: 'Nested msg' } } }) },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
    if (res.ok || res.needsConfirm) { return; }
    expect(res.error.code).toBe('777');
    expect(res.error.message).toBe('Nested msg');
  });

  it('returns error from GET /Cellsets and still attempts DELETE for cleanup', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '5' },                                                   // $count
      { statusCode: 500, body: JSON.stringify({ error: { code: '999', message: 'internal' } }) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
    if (res.ok) { return; }
    if (res.needsConfirm) { return; }
    expect(res.error.message).toBe('internal');
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'GET', 'DELETE']);
  });

  it('DELETE failure does not affect successful result', async () => {
    const cellsetJson = {
      Axes: [
        { Hierarchies: [{ Name: 'D' }], Tuples: [{ Members: [{ Name: 'M' }] }] },
        { Hierarchies: [{ Name: 'T' }], Tuples: [{ Members: [{ Name: 'all' }] }] },
      ],
      Cells: [],
    };
    const { api } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '5' },                    // $count
      { statusCode: 200, body: JSON.stringify(cellsetJson) },
      { statusCode: 500, body: '{}' },  // DELETE fails
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
  });

  it('reports elapsed time in ms', async () => {
    const { api } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '5' },                    // $count
      { statusCode: 200, body: JSON.stringify({ Axes: [{Hierarchies:[{Name:'D'}],Tuples:[{Members:[{Name:'M'}]}]},{Hierarchies:[{Name:'T'}],Tuples:[{Members:[{Name:'a'}]}]}], Cells: [] }) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
    if (!res.ok) { return; }
    expect(typeof res.elapsedMs).toBe('number');
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('handles non-JSON 400 body gracefully', async () => {
    const { api } = makeApi([
      { statusCode: 400, body: '<html>not json</html>' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
    if (res.ok || res.needsConfirm) { return; }
    expect(res.error.code).toBe('400');
    expect(typeof res.error.message).toBe('string');
  });

  it('returns error if POST 201 body has no ID', async () => {
    const { api } = makeApi([
      { statusCode: 201, body: JSON.stringify({ unexpectedField: 'oops' }) },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
  });
});

describe('executeMdx 50k pre-check', () => {
  const mdx = 'SELECT {[Dim].MEMBERS} ON 0 FROM [Cube]';
  const cellsetId = 'cs-id';

  it('exports MDX_CELL_LIMIT = 50_000', () => {
    expect(MDX_CELL_LIMIT).toBe(50_000);
  });

  it('count <= limit → fetches full cellset and deletes (normal path)', async () => {
    const cellsetJson = {
      Axes: [
        { Hierarchies: [{ Name: 'D' }], Tuples: [{ Members: [{ Name: 'E' }] }] },
        { Hierarchies: [{ Name: 'T' }], Tuples: [{ Members: [{ Name: 'a' }] }] },
      ],
      Cells: [{ Ordinal: 0, Value: 1, FormattedValue: '1' }],
    };
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '120' },  // $count
      { statusCode: 200, body: JSON.stringify(cellsetJson) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'GET', 'DELETE']);
    expect(calls[1].path).toContain('Cells/$count');
  });

  it('count > limit → returns needsConfirm without fetching cellset', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: '75000' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(false);
    if (res.ok) { return; }
    expect(res.needsConfirm).toBe(true);
    if (!res.needsConfirm) { return; }
    expect(res.cellCount).toBe(75000);
    expect(res.cellsetId).toBe(cellsetId);
    // No GET of $expand, no DELETE yet (user must decide).
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET']);
  });

  it('$count HTTP 400 → falls back via axis-cardinality product', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 400, body: 'count not supported' },
      // Axis cardinalities: 10 * 5 = 50 → under limit → proceed
      { statusCode: 200, body: JSON.stringify({ value: [{ Cardinality: 10 }, { Cardinality: 5 }] }) },
      {
        statusCode: 200,
        body: JSON.stringify({
          Axes: [
            { Hierarchies: [{ Name: 'D' }], Tuples: [{ Members: [{ Name: 'E' }] }] },
            { Hierarchies: [{ Name: 'T' }], Tuples: [{ Members: [{ Name: 'a' }] }] },
          ],
          Cells: [],
        }),
      },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'GET', 'GET', 'DELETE']);
    expect(calls[2].path).toContain('Axes?$select=Cardinality');
  });

  it('$count HTTP 200 with non-numeric body → falls back via axes', async () => {
    const cellsetJson = {
      Axes: [
        { Hierarchies: [{ Name: 'D' }], Tuples: [{ Members: [{ Name: 'E' }] }] },
        { Hierarchies: [{ Name: 'T' }], Tuples: [{ Members: [{ Name: 'a' }] }] },
      ],
      Cells: [],
    };
    const { api, calls } = makeApi([
      { statusCode: 201, body: JSON.stringify({ ID: cellsetId }) },
      { statusCode: 200, body: 'not-a-number' },                            // $count garbage
      { statusCode: 200, body: JSON.stringify({ value: [{ Cardinality: 2 }, { Cardinality: 3 }] }) },
      { statusCode: 200, body: JSON.stringify(cellsetJson) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdx(mdx, api);

    expect(res.ok).toBe(true);
    expect(calls[2].path).toContain('Axes?$select=Cardinality');
  });

  it('executeMdxContinue fetches and deletes an already-created cellset', async () => {
    const cellsetJson = {
      Axes: [
        { Hierarchies: [{ Name: 'D' }], Tuples: [{ Members: [{ Name: 'E' }] }] },
        { Hierarchies: [{ Name: 'T' }], Tuples: [{ Members: [{ Name: 'a' }] }] },
      ],
      Cells: [],
    };
    const { api, calls } = makeApi([
      { statusCode: 200, body: JSON.stringify(cellsetJson) },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdxContinue(cellsetId, api);

    expect(res.ok).toBe(true);
    expect(calls.map(c => c.method)).toEqual(['GET', 'DELETE']);
    expect(calls[0].path).toContain(`Cellsets('${cellsetId}')?$expand`);
  });
});

describe('isBareSetMdx', () => {
  it('detects bare set', () => {
    expect(isBareSetMdx('{ [D].[H].[E] }')).toBe(true);
  });
  it('detects bare set with leading comments', () => {
    expect(isBareSetMdx('// Dim: X\n// 2 Elemente\n{ [D].[H].[E] }')).toBe(true);
  });
  it('SELECT is not bare set', () => {
    expect(isBareSetMdx('SELECT {[D].[E]} ON 0 FROM [C]')).toBe(false);
  });
  it('WITH MEMBER is not bare set', () => {
    expect(isBareSetMdx('WITH MEMBER [M].[X] AS 1 SELECT … ')).toBe(false);
  });
  it('empty / whitespace → false', () => {
    expect(isBareSetMdx('   \n  ')).toBe(false);
  });
});

describe('parseFirstDimHier', () => {
  it('3-segment yields dim + hier, unambiguously', () => {
    expect(parseFirstDimHier('{ [Jahre].[Jahre].[2025] }'))
      .toEqual({ dim: 'Jahre', hier: 'Jahre', hierAmbiguous: false });
  });
  it('2-segment guesses the 2nd bracket as hierarchy, but flags it ambiguous', () => {
    expect(parseFirstDimHier('TM1SUBSETALL([Jahre].[Jahre])'))
      .toEqual({ dim: 'Jahre', hier: 'Jahre', hierAmbiguous: true });
  });
  it('2-segment where the 2nd bracket is an ELEMENT is flagged the same way', () => {
    // `[Dim].[Member]` is the common form; guessing it as a hierarchy produced
    // TM1 error 278 "'…' can not be found in collection of type 'Hierarchy'".
    expect(parseFirstDimHier('{ [Maintenance_Elemente].[SuMaintenance_Items_C] }'))
      .toEqual({ dim: 'Maintenance_Elemente', hier: 'SuMaintenance_Items_C', hierAmbiguous: true });
  });
  it('single bracket (no hierarchy) → defaults hier = dim (same-name hierarchy)', () => {
    expect(parseFirstDimHier('{TM1SUBSETALL([aa])}'))
      .toEqual({ dim: 'aa', hier: 'aa', hierAmbiguous: false });
  });
  it('no bracket pair → null', () => {
    expect(parseFirstDimHier('// only comment\n')).toBeNull();
  });
});

describe('executeMdxAsSet — ambiguous hierarchy resolution', () => {
  const MDX = '{ [Dim].[SomeElement] }';
  const hierList = (names: string[]) =>
    ({ statusCode: 200, body: JSON.stringify({ value: names.map(Name => ({ Name })) }) });
  // Fresh object per use: parseBody releases the body (`res.body = ''`), so a
  // shared literal would arrive empty in the second test.
  const elements = () => ({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'E1' }] }) });

  it('falls back to the same-name hierarchy when the guess is not a hierarchy', async () => {
    const { api, calls } = makeApi([
      hierList(['Dim', 'AltHier']),          // verification: SomeElement is not among them
      { statusCode: 201, body: '{}' },       // POST temp subset
      elements(),                            // GET Elements
      { statusCode: 204, body: '' },         // DELETE
    ]);
    const res = await executeMdxAsSet(MDX, api);
    expect(res.ok).toBe(true);
    expect(calls[0].path).toContain("Dimensions('Dim')/Hierarchies?$select=Name");
    expect(calls[1].path).toContain("Dimensions('Dim')/Hierarchies('Dim')/PrivateSubsets");
    expect(calls[1].path).not.toContain('SomeElement');
  });

  it('keeps the parsed hierarchy when it really is one', async () => {
    const { api, calls } = makeApi([
      hierList(['Dim', 'SomeElement']),
      { statusCode: 201, body: '{}' },
      elements(),
      { statusCode: 204, body: '' },
    ]);
    const res = await executeMdxAsSet(MDX, api);
    expect(res.ok).toBe(true);
    // The verification GET must really have happened — asserting only on the
    // POST path would also pass against the pre-fix implementation, whose
    // GET-Elements URL happens to contain `Hierarchies('SomeElement')/PrivateSubsets`
    // as a substring.
    expect(calls).toHaveLength(4);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toContain('Hierarchies?$select=Name');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].path).toContain("Hierarchies('SomeElement')/PrivateSubsets");
  });

  it('matches the hierarchy case-insensitively and adopts the server spelling', async () => {
    // TM1 object names are case-insensitive (live-verified on 11.8:
    // `Dimensions('aa')/Hierarchies('TEST')` → 200 `"Name":"test"`), so an
    // exact compare wrongly rewrote the hierarchy to the dimension name.
    const { api, calls } = makeApi([
      hierList(['Dim', 'Europa']),
      { statusCode: 201, body: '{}' },
      elements(),
      { statusCode: 204, body: '' },
    ]);
    const res = await executeMdxAsSet('{TM1SUBSETALL([Dim].[EUROPA])}', api);
    expect(res.ok).toBe(true);
    expect(calls[0].path).toContain('Hierarchies?$select=Name');
    // Canonical server casing, not the MDX spelling.
    expect(calls[1].path).toContain("Hierarchies('Europa')/PrivateSubsets");
    expect(calls[1].path).not.toContain('EUROPA');
  });

  it('treats a hierarchy that only differs from the dim by case as the same-name hierarchy', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: '{}' },
      elements(),
      { statusCode: 204, body: '' },
    ]);
    await executeMdxAsSet('{TM1SUBSETALL([Dim].[dIM])}', api);
    // No verification GET: `dIM` IS `Dim` for TM1, so there is nothing to settle.
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toContain("Hierarchies('dIM')/PrivateSubsets");
  });

  it('falls back to the same-name hierarchy when the listing itself fails', async () => {
    // No evidence → `dim`, never the parsed guess: for `[Dim].[Element]` the
    // guess is the ELEMENT name, and putting that in the Hierarchies segment is
    // exactly the TM1 error 278 this resolution exists to prevent. A transient
    // 503 or a user lacking rights on the Hierarchies listing must not
    // reproduce the original bug.
    const { api, calls } = makeApi([
      { statusCode: 500, body: '{}' },
      { statusCode: 201, body: '{}' },
      elements(),
      { statusCode: 204, body: '' },
    ]);
    await executeMdxAsSet(MDX, api);
    expect(calls[1].path).toContain("Dimensions('Dim')/Hierarchies('Dim')/PrivateSubsets");
    expect(calls[1].path).not.toContain('SomeElement');
  });

  it('falls back to the same-name hierarchy when the listing REJECTS (throws)', async () => {
    const calls: { method: string; path: string }[] = [];
    let i = 0;
    const responses = [
      { statusCode: 201, body: '{}' },
      { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'E1' }] }) },
      { statusCode: 204, body: '' },
    ];
    const api = async (method: string, path: string) => {
      calls.push({ method, path });
      if (path.includes('Hierarchies?$select=Name')) { throw new Error('ECONNRESET'); }
      return responses[i++] ?? { statusCode: 500, body: '{}' };
    };
    await executeMdxAsSet(MDX, api);
    expect(calls[1].path).toContain("Dimensions('Dim')/Hierarchies('Dim')/PrivateSubsets");
    expect(calls[1].path).not.toContain('SomeElement');
  });

  it('spends no verification call on an unambiguous 3-segment reference', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: '{}' },
      elements(),
      { statusCode: 204, body: '' },
    ]);
    await executeMdxAsSet('{ [Dim].[AltHier].[E1] }', api);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toContain("Hierarchies('AltHier')/PrivateSubsets");
  });
});

describe('executeMdxAsSet', () => {
  it('POSTs PrivateSubset with Expression, GETs Elements, DELETEs subset, returns 1-col table', async () => {
    const elements = { value: [{ Name: 'SuJahre' }, { Name: '2015' }, { Name: '2037' }] };
    const { api, calls } = makeApi([
      { statusCode: 201, body: '{}' },
      { statusCode: 200, body: JSON.stringify(elements) },
      { statusCode: 204, body: '' },
    ]);

    const mdx = '// Dimension: Jahre\n{ [Jahre].[Jahre].[SuJahre], [Jahre].[Jahre].[2015], [Jahre].[Jahre].[2037] }';
    const res = await executeMdxAsSet(mdx, api);

    expect(res.ok).toBe(true);
    if (!res.ok) { return; }
    expect(res.table.dims).toEqual({ cols: 1, rows: 3 });
    expect(res.table.rowHierarchies).toEqual(['Jahre.Jahre']);
    expect(res.table.rowHeaders).toEqual([['SuJahre'], ['2015'], ['2037']]);
    expect(res.table.cells.map(r => r[0].formatted)).toEqual(['SuJahre', '2015', '2037']);

    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'DELETE']);
    expect(calls[0].path).toMatch(/Dimensions\('Jahre'\)\/Hierarchies\('Jahre'\)\/PrivateSubsets$/);
    const postBody = JSON.parse(calls[0].body || '{}');
    expect(postBody.Name).toMatch(/^_tm1ti_runner_/);
    expect(postBody.Expression).toBe(
      '{ [Jahre].[Jahre].[SuJahre], [Jahre].[Jahre].[2015], [Jahre].[Jahre].[2037] }',
    );
    expect(calls[1].path).toContain('/Elements?$select=Name,Type,Level');
    expect(calls[2].method).toBe('DELETE');
  });

  it('cleans up subset even when GET Elements fails', async () => {
    const { api, calls } = makeApi([
      { statusCode: 201, body: '{}' },
      { statusCode: 500, body: '{"error":{"code":"X","message":"boom"}}' },
      { statusCode: 204, body: '' },
    ]);

    const res = await executeMdxAsSet('{ [D].[H].[E] }', api);

    expect(res.ok).toBe(false);
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET', 'DELETE']);
  });

  it('returns error when dim/hier cannot be parsed', async () => {
    const { api, calls } = makeApi([]);
    const res = await executeMdxAsSet('{ NoBracketsHere }', api);
    expect(res.ok).toBe(false);
    if (res.ok || res.needsConfirm) { return; }
    expect(res.error.code).toBe('bare-set');
    expect(calls).toEqual([]);
  });

  it('executeMdx routes bare set through executeMdxAsSet (no POST /ExecuteMDX)', async () => {
    const elements = { value: [{ Name: 'E1' }] };
    const { api, calls } = makeApi([
      { statusCode: 201, body: '{}' },
      { statusCode: 200, body: JSON.stringify(elements) },
      { statusCode: 204, body: '' },
    ]);
    const res = await executeMdx('{ [D].[H].[E1] }', api);
    expect(res.ok).toBe(true);
    // No POST /ExecuteMDX call.
    expect(calls.every(c => !c.path.includes('ExecuteMDX'))).toBe(true);
    expect(calls[0].path).toContain('PrivateSubsets');
  });
});

describe('executeMdx — transport rejection after the cellset exists', () => {
  const mdx = 'SELECT {[Dim].MEMBERS} ON 0 FROM [Cube]';
  // Rejects the request at `failAt` (0-based), like ECONNRESET; answers the rest.
  function rejectingApi(failAt: number) {
    const calls: string[] = [];
    const api = async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      if (calls.length - 1 === failAt) { throw new Error('ECONNRESET'); }
      if (method === 'POST') { return { statusCode: 201, body: JSON.stringify({ ID: 'cs1' }) }; }
      if (path.includes('$count')) { return { statusCode: 200, body: '5' }; }
      return { statusCode: 204, body: '' };
    };
    return { api, calls };
  }

  it('deletes the cellset when the $count GET rejects', async () => {
    const { api, calls } = rejectingApi(1);
    await expect(executeMdx(mdx, api)).rejects.toThrow('ECONNRESET');
    expect(calls.at(-1)).toBe("DELETE Cellsets('cs1')");
  });

  it('deletes the cellset when the full cellset GET rejects', async () => {
    const { api, calls } = rejectingApi(2);
    await expect(executeMdx(mdx, api)).rejects.toThrow('ECONNRESET');
    expect(calls.at(-1)).toBe("DELETE Cellsets('cs1')");
  });
});
