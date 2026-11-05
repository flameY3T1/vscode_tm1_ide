// src/test/dimensionEditor/dimensionApi.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DimensionApi } from '../../tm1Rest/dimensionApi';

function mockApi(responses: Array<{ statusCode: number; body: string }>) {
  let i = 0;
  return vi.fn(async () => responses[i++] ?? { statusCode: 500, body: '{}' });
}

describe('DimensionApi.createElement', () => {
  it('POSTs to Elements endpoint with correct body', async () => {
    const fetch = mockApi([{ statusCode: 201, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'Products', config: undefined as never });
    await api.createElement('Products', 'Phone', 'N');
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Dimensions('Products')/Hierarchies('Products')/Elements",
      { Name: 'Phone', Type: 'Numeric' },
      undefined,
      undefined,
    );
  });

  it('maps type N→Numeric, C→Consolidated, S→String', async () => {
    const fetch = mockApi([
      { statusCode: 201, body: '{}' },
      { statusCode: 201, body: '{}' },
      { statusCode: 201, body: '{}' },
    ]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.createElement('D', 'n', 'N');
    await api.createElement('D', 'c', 'C');
    await api.createElement('D', 's', 'S');
    expect(((fetch.mock.calls[0] as unknown[])[2] as any).Type).toBe('Numeric');
    expect(((fetch.mock.calls[1] as unknown[])[2] as any).Type).toBe('Consolidated');
    expect(((fetch.mock.calls[2] as unknown[])[2] as any).Type).toBe('String');
  });

  it('throws on non-2xx response', async () => {
    const fetch = mockApi([{ statusCode: 400, body: '{"error":{"message":"bad"}}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await expect(api.createElement('D', 'Bad', 'N')).rejects.toThrow(/bad/);
  });

  it('createElements sends one POST with element array (TM1 types)', async () => {
    const fetch = mockApi([{ statusCode: 201, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.createElements('D', [{ name: 'A', type: 'N' }, { name: 'T', type: 'C' }]);
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Dimensions('D')/Hierarchies('D')/Elements",
      [{ Name: 'A', Type: 'Numeric' }, { Name: 'T', Type: 'Consolidated' }],
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.deleteElement', () => {
  it('DELETEs at correct path with URL-encoded name', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.deleteElement('D', "O'Brien");
    expect(fetch).toHaveBeenCalledWith(
      'DELETE',
      `Dimensions('D')/Hierarchies('D')/Elements('O''Brien')`,
      undefined,
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.changeElementType', () => {
  it('PATCHes the element in-place with mapped Type', async () => {
    const fetch = mockApi([{ statusCode: 200, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.changeElementType('D', "O'Brien", 'S');
    expect(fetch).toHaveBeenCalledWith(
      'PATCH',
      `Dimensions('D')/Hierarchies('D')/Elements('O''Brien')`,
      { Type: 'String' },
      undefined,
      undefined,
    );
  });

  it('throws on non-2xx (element stays untouched — no delete)', async () => {
    const fetch = mockApi([{ statusCode: 400, body: '{"error":{"message":"nope"}}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await expect(api.changeElementType('D', 'A', 'N')).rejects.toThrow(/nope/);
    expect(fetch).toHaveBeenCalledTimes(1); // only the PATCH, no DELETE fallback
  });
});

describe('DimensionApi.setEdge', () => {
  it('POSTs to Edges endpoint', async () => {
    const fetch = mockApi([{ statusCode: 201, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.addEdge('D', 'All', 'Phone', 1);
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Dimensions('D')/Hierarchies('D')/Edges",
      { ParentName: 'All', ComponentName: 'Phone', Weight: 1 },
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.deleteEdge', () => {
  it('DELETEs with compound key syntax', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.deleteEdge('D', 'All', 'Phone');
    expect(fetch).toHaveBeenCalledWith(
      'DELETE',
      `Dimensions('D')/Hierarchies('D')/Edges(ParentName='All',ComponentName='Phone')`,
      undefined,
      undefined,
      undefined,
    );
  });

  it('addEdges sends one POST with edge array', async () => {
    const fetch = mockApi([{ statusCode: 201, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.addEdges('D', [
      { parent: 'All', child: 'Phone', weight: 1 },
      { parent: 'All', child: 'Tablet', weight: 2 },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Dimensions('D')/Hierarchies('D')/Edges",
      [
        { ParentName: 'All', ComponentName: 'Phone', Weight: 1 },
        { ParentName: 'All', ComponentName: 'Tablet', Weight: 2 },
      ],
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.setEdgeWeight', () => {
  it('PATCHes the edge key with the weight only', async () => {
    const fetch = mockApi([{ statusCode: 200, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.setEdgeWeight('D', "O'Brien", 'Phone', -1);
    expect(fetch).toHaveBeenCalledWith(
      'PATCH',
      `Dimensions('D')/Hierarchies('D')/Edges(ParentName='O''Brien',ComponentName='Phone')`,
      { Weight: -1 },
      undefined,
      undefined,
    );
  });

  it('throws on non-2xx', async () => {
    const fetch = mockApi([{ statusCode: 404, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await expect(api.setEdgeWeight('D', 'All', 'Phone', 2)).rejects.toThrow(/setEdgeWeight/);
  });
});

describe('DimensionApi.setAttr', () => {
  it('POSTs to attribute cube with v1.7.2 shape (Value top-level, stringified)', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.setAttr('D', 'Phone', 'alias', 'Telefon');
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Cubes('%7DElementAttributes_D')/tm1.Update",
      {
        Cells: [{ 'Tuple@odata.bind': [
          "Dimensions('D')/Hierarchies('D')/Elements('Phone')",
          "Dimensions('%7DElementAttributes_D')/Hierarchies('%7DElementAttributes_D')/Elements('alias')",
        ] }],
        Value: 'Telefon',
      },
      undefined,
      undefined,
    );
  });

  it('sends numeric values as a JSON number, not a string (locale-parsing defect, measured 2026-08-12)', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.setAttr('D', 'Phone', 'LaunchYear', 2024);
    const body = (fetch as any).mock.calls[0][2];
    expect(body.Value).toBe(2024);
    expect(typeof body.Value).toBe('number');
    expect(body.Cells[0]).not.toHaveProperty('Value');
  });

  it('escapes apostrophes in element/attr/dim names', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: "O'Dim", config: undefined as never });
    await api.setAttr("O'Hier", "O'Elem", "O'Attr", "v");
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Cubes('%7DElementAttributes_O''Dim')/tm1.Update",
      {
        Cells: [{ 'Tuple@odata.bind': [
          "Dimensions('O''Dim')/Hierarchies('O''Hier')/Elements('O''Elem')",
          "Dimensions('%7DElementAttributes_O''Dim')/Hierarchies('%7DElementAttributes_O''Dim')/Elements('O''Attr')",
        ] }],
        Value: 'v',
      },
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.createHierarchy', () => {
  it('POSTs to Hierarchies endpoint', async () => {
    const fetch = mockApi([{ statusCode: 201, body: '{}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.createHierarchy('D', 'NewHier');
    expect(fetch).toHaveBeenCalledWith(
      'POST',
      "Dimensions('D')/Hierarchies",
      { Name: 'NewHier' },
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.deleteHierarchy', () => {
  it('DELETEs Hierarchies endpoint', async () => {
    const fetch = mockApi([{ statusCode: 204, body: '' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.deleteHierarchy('D', 'Old');
    expect(fetch).toHaveBeenCalledWith(
      'DELETE',
      "Dimensions('D')/Hierarchies('Old')",
      undefined,
      undefined,
      undefined,
    );
  });
});

describe('DimensionApi.fetchSnapshot', () => {
  it('fetches hierarchies, elements, edges, attrDefs in parallel', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Products' }] }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
        { Name: 'Phone', Type: 'Numeric', Attributes: { alias: 'Tel' } },
      ]})})
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
        { ParentName: 'All', ComponentName: 'Phone', Weight: 1 },
      ]})})
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [
        { Name: 'alias', Type: 'Alias' },
      ]})});

    const api = new DimensionApi(fetch as any, { dimName: 'Products', config: undefined as never });
    const snap = await api.fetchSnapshot('Products');
    expect(snap.dimName).toBe('Products');
    expect(snap.hierarchies).toEqual(['Products']);
    expect(snap.perHier['Products'].elements[0].name).toBe('Phone');
    expect(snap.perHier['Products'].elements[0].type).toBe('N');
    expect(snap.perHier['Products'].edges[0].parent).toBe('All');
    expect(snap.perHier['Products'].attrDefs[0].name).toBe('alias');
  });

  it('fetches elements without $expand=Attributes (OData complex-type quirk)', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Products' }] }) })  // hierarchies
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) })  // elements
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) })  // edges
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) }); // attrDefs

    const api = new DimensionApi(fetch as any, { dimName: 'Products', config: undefined as never });
    await api.fetchSnapshot('Products');

    const elementsCall = fetch.mock.calls.find(c => /\/Elements\?/.test(c[1]));
    expect(elementsCall).toBeTruthy();
    expect(elementsCall![1]).not.toContain('$expand=Attributes');
    expect(elementsCall![1]).toContain('$select=Name,Type,Attributes');
  });

  it('loads content for all hierarchies (multi-hier support)', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Products' }, { Name: 'ByBrand' }] }) })  // hierarchies
      // Hier "Products"
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'A', Type: 'Numeric', Attributes: {} }] }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) })
      // Hier "ByBrand"
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Apple', Type: 'Numeric', Attributes: {} }] }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ value: [] }) });

    const api = new DimensionApi(fetch as any, { dimName: 'Products', config: undefined as never });
    const snap = await api.fetchSnapshot('Products');

    expect(snap.hierarchies).toEqual(['Products', 'ByBrand']);
    expect(snap.perHier['Products'].elements[0].name).toBe('A');
    expect(snap.perHier['ByBrand'].elements[0].name).toBe('Apple');
  });
});

describe('DimensionApi.createDimensionFull', () => {
  it('createDimensionFull POSTs Dimensions with elements+edges in one body', async () => {
    const calls: any[] = [];
    const fetchMock = async (m: string, p: string, b?: unknown) => { calls.push({ m, p, b }); return { statusCode: 201, body: '' }; };
    const api = new DimensionApi(fetchMock as any, { dimName: 'D', config: {} as any });
    await api.createDimensionFull('D', 'D', [{ name: 'A', type: 'N' }], [{ parent: 'T', child: 'A', weight: 1 }]);
    expect(calls[0].m).toBe('POST');
    expect(calls[0].p).toBe('Dimensions');
    expect(calls[0].b).toEqual({ Name: 'D', Hierarchies: [{ Name: 'D',
      Elements: [{ Name: 'A', Type: 'Numeric' }],
      Edges: [{ ParentName: 'T', ComponentName: 'A', Weight: 1 }] }] });
  });
});

describe('DimensionApi.writeAttrValues', () => {
  it('writeAttrValues builds ExecuteMDX + PATCH Cells with row-major ordinals, then deletes cellset', async () => {
    const calls: any[] = [];
    const fetchMock = async (m: string, p: string, b?: unknown) => {
      calls.push({ m, p, b });
      if (p === 'ExecuteMDX') return { statusCode: 201, body: JSON.stringify({ ID: 'CS1' }) };
      return { statusCode: 204, body: '' };
    };
    const api = new DimensionApi(fetchMock as any, { dimName: 'D', config: {} as any });
    await api.writeAttrValues([
      { element: 'A', attr: 'alias', value: 'aa' },
      { element: 'B', attr: 'num', value: 5 },
    ]);
    const mdx = calls.find(c => c.p === 'ExecuteMDX');
    expect(mdx.b.MDX).toContain('}ElementAttributes_D');
    const patch = calls.find(c => c.m === 'PATCH' && c.p.includes('Cellsets'));
    // distinct elements [A,B], distinct attrs [alias,num]; ordinal = elemIdx*2 + attrIdx
    expect(patch.b).toEqual([{ Ordinal: 0, Value: 'aa' }, { Ordinal: 3, Value: 5 }]);
    expect(calls.some(c => c.m === 'DELETE' && c.p.includes("Cellsets('CS1')"))).toBe(true);
  });

  it('addresses rows through the edited hierarchy, not the same-name one', async () => {
    const calls: any[] = [];
    const fetchMock = async (m: string, p: string, b?: unknown) => {
      calls.push({ m, p, b });
      if (p === 'ExecuteMDX') return { statusCode: 201, body: JSON.stringify({ ID: 'CS1' }) };
      return { statusCode: 204, body: '' };
    };
    const api = new DimensionApi(fetchMock as any, { dimName: 'D', config: {} as any });
    await api.writeAttrValues([
      { hier: 'Alt', element: 'Total', attr: 'alias', value: 'aa' },
      { hier: 'Alt', element: 'Total', attr: 'num', value: 5 },
      { element: 'Leaf', attr: 'alias', value: 'll' },
    ]);
    const mdx = calls.find(c => c.p === 'ExecuteMDX').b.MDX as string;
    expect(mdx).toContain('{[D].[Alt].[Total],[D].[D].[Leaf]} ON ROWS');
    const patch = calls.find(c => c.m === 'PATCH' && c.p.includes('Cellsets'));
    expect(patch.b).toEqual([{ Ordinal: 0, Value: 'aa' }, { Ordinal: 1, Value: 5 }, { Ordinal: 2, Value: 'll' }]);
  });

  it('attribute definitions go through the given hierarchy', async () => {
    const calls: any[] = [];
    const fetchMock = async (m: string, p: string) => { calls.push({ m, p }); return { statusCode: 201, body: '{}' }; };
    const api = new DimensionApi(fetchMock as any, { dimName: 'D', config: {} as any });
    await api.createAttrDef('D', 'alias', 'Alias', 'Alt');
    await api.deleteAttrDef('D', 'alias', 'Alt');
    expect(calls[0].p).toBe("Dimensions('D')/Hierarchies('Alt')/ElementAttributes");
    expect(calls[1].p).toBe("Dimensions('D')/Hierarchies('Alt')/ElementAttributes('alias')");
  });
});

/**
 * Alternate hierarchies: the hierarchy name must NOT be used as the
 * dimension name.
 *
 * Until 2026-08-14, all seven element/edge routes built the URL as
 * `Dimensions('<hier>')/Hierarchies('<hier>')/…`. With the main hierarchy this
 * never showed — it is named like the dimension. With `ab` this turned into
 * `Dimensions('ab')`, i.e. a dimension that does not exist: the editor created
 * the element in the tree, and saving failed.
 *
 * Every existing test called with `hier === dimName` and therefore could not see
 * the bug; these cases explicitly call with a differing
 * hierarchy.
 */
describe('DimensionApi with a secondary hierarchy', () => {
  const DIM = 'Products';
  const HIER = 'ab';

  function apiWithSpy() {
    const calls: Array<{ method: string; path: string }> = [];
    const fetch = vi.fn(async (method: string, path: string) => {
      calls.push({ method, path });
      return { statusCode: 204, body: '{}' };
    });
    return { api: new DimensionApi(fetch as any, { dimName: DIM, config: undefined as never }), calls };
  }

  const cases: Array<[string, (a: DimensionApi) => Promise<void>]> = [
    ['createElement', (a) => a.createElement(HIER, 'X', 'N')],
    ['createElements', (a) => a.createElements(HIER, [{ name: 'X', type: 'N' }])],
    ['changeElementType', (a) => a.changeElementType(HIER, 'X', 'C')],
    ['deleteElement', (a) => a.deleteElement(HIER, 'X')],
    ['addEdge', (a) => a.addEdge(HIER, 'T', 'X', 1)],
    ['addEdges', (a) => a.addEdges(HIER, [{ parent: 'T', child: 'X', weight: 1 }])],
    ['deleteEdge', (a) => a.deleteEdge(HIER, 'T', 'X')],
  ];

  for (const [name, call] of cases) {
    it(`${name} adressiert Dimensions('${DIM}')/Hierarchies('${HIER}')`, async () => {
      const { api, calls } = apiWithSpy();
      await call(api);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c.path.startsWith(`Dimensions('${DIM}')/Hierarchies('${HIER}')`)).toBe(true);
        expect(c.path).not.toContain(`Dimensions('${HIER}')`);
      }
    });
  }
});

describe('DimensionApi.reorderElements', () => {
  it('PATCHes the hierarchy with elements AND edges', async () => {
    const fetch = mockApi([
      { statusCode: 200, body: '{"value":[{"Name":"B"},{"Name":"A"}]}' },
      { statusCode: 200, body: '{}' },
    ]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await api.reorderElements('D', [{ name: 'A', type: 'N' }, { name: 'B', type: 'C' }], [{ parent: 'B', child: 'A', weight: 1 }]);
    expect(fetch).toHaveBeenLastCalledWith('PATCH', "Dimensions('D')/Hierarchies('D')", {
      Elements: [{ Name: 'A', Type: 'Numeric' }, { Name: 'B', Type: 'Consolidated' }],
      Edges: [{ ParentName: 'B', ComponentName: 'A', Weight: 1 }],
    }, undefined, undefined);
  });

  // The PATCH replaces the element set: an element the draft does not list
  // would be deleted on the server. Refuse instead.
  it('does not PATCH when the server has an element the list lacks', async () => {
    const fetch = mockApi([{ statusCode: 200, body: '{"value":[{"Name":"A"},{"Name":"Extra"}]}' }]);
    const api = new DimensionApi(fetch as any, { dimName: 'D', config: undefined as never });
    await expect(api.reorderElements('D', [{ name: 'A', type: 'N' }], [])).rejects.toThrow(/Extra/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
