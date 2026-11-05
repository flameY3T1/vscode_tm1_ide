import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listDimensionNames, listDimensionsWithHierarchies, listHierarchyNames,
  listElementAttributes, listElementAttributeNames, listElementNames, listElementNamesAndLeaves, listEdges, listWeightedEdges,
  createDimension, deleteDimension, createHierarchy, deleteHierarchy, DimensionApi, type ApiResponse,
} from '../../tm1Rest/dimensionApi';
import { deleteCube } from '../../tm1Rest/cubeApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('dimensionApi — functional helpers', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('listDimensionNames', () => {
    it('returns array of names on 200', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain('Dimensions?$select=Name');
        jsonResponse(res, 200, { value: [{ Name: 'D1' }, { Name: 'D2' }] });
      });
      expect(await listDimensionNames(fakeConfig(fake.url))).toEqual(['D1', 'D2']);
    });

    it('throws on non-2xx (an empty list would read as "no objects")', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      await expect(listDimensionNames(fakeConfig(fake.url))).rejects.toThrow();
    });
  });

  describe('listElementNamesAndLeaves', () => {
    it('leaves keep string elements, drop consolidations', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { value: [
          { Name: 'T', Type: 'Consolidated' }, { Name: 'A', Type: 'Numeric' }, { Name: 'Note', Type: 'String' },
        ] });
      });
      expect(await listElementNamesAndLeaves(fakeConfig(fake.url), 'D')).toEqual({ names: ['T', 'A', 'Note'], leaves: ['A', 'Note'] });
    });
  });

  describe('listDimensionsWithHierarchies', () => {
    it('returns raw rows on 200', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain('Dimensions?$select=Name,Hierarchies');
        jsonResponse(res, 200, {
          value: [{ Name: 'D', Hierarchies: [{ Name: 'D' }, { Name: 'Leaves' }] }],
        });
      });
      const out = await listDimensionsWithHierarchies(fakeConfig(fake.url));
      expect(out[0].Hierarchies).toHaveLength(2);
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await listDimensionsWithHierarchies(fakeConfig(fake.url))).toEqual([]);
    });
  });

  describe('listHierarchyNames', () => {
    it('returns hierarchy names for a dimension', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain("Dimensions('D')/Hierarchies?$select=Name");
        jsonResponse(res, 200, { value: [{ Name: 'H1' }, { Name: 'H2' }] });
      });
      expect(await listHierarchyNames(fakeConfig(fake.url), 'D')).toEqual(['H1', 'H2']);
    });

    it('throws on non-2xx (an empty list would read as "no objects")', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      await expect(listHierarchyNames(fakeConfig(fake.url), 'D')).rejects.toThrow();
    });
  });

  describe('listElementAttributes / listElementAttributeNames', () => {
    it('listElementAttributes returns full rows', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain("ElementAttributes");
        jsonResponse(res, 200, {
          value: [{ Name: 'Alias', Type: 'Alias' }, { Name: 'Color', Type: 'String' }],
        });
      });
      const rows = await listElementAttributes(fakeConfig(fake.url), 'D');
      expect(rows).toEqual([{ Name: 'Alias', Type: 'Alias' }, { Name: 'Color', Type: 'String' }]);
    });

    it('listElementAttributes defaults hier to dim', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listElementAttributes(fakeConfig(fake.url), 'D');
      expect(observedUrl).toContain("Dimensions('D')/Hierarchies('D')");
    });

    it('listElementAttributeNames maps to name strings', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { value: [{ Name: 'A' }, { Name: 'B' }] });
      });
      expect(await listElementAttributeNames(fakeConfig(fake.url), 'D', 'H')).toEqual(['A', 'B']);
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end();
      });
      expect(await listElementAttributes(fakeConfig(fake.url), 'D')).toEqual([]);
      expect(await listElementAttributeNames(fakeConfig(fake.url), 'D')).toEqual([]);
    });
  });

  describe('listElementNames', () => {
    it('returns names without $top by default', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'A' }, { Name: 'B' }] });
      });
      const names = await listElementNames(fakeConfig(fake.url), 'D');
      expect(observedUrl).not.toContain('$top');
      expect(names).toEqual(['A', 'B']);
    });

    it('appends $top when provided', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listElementNames(fakeConfig(fake.url), 'D', 'H', { top: 50 });
      expect(observedUrl).toContain('$top=50');
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      expect(await listElementNames(fakeConfig(fake.url), 'D')).toEqual([]);
    });
  });

  describe('listEdges', () => {
    it('returns parent/child rows', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain('Edges?$select=ParentName,ComponentName');
        jsonResponse(res, 200, {
          value: [
            { ParentName: 'Total', ComponentName: 'A' },
            { ParentName: 'Total', ComponentName: 'B' },
          ],
        });
      });
      const out = await listEdges(fakeConfig(fake.url), 'D');
      expect(out).toHaveLength(2);
      expect(out[0].ParentName).toBe('Total');
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await listEdges(fakeConfig(fake.url), 'D')).toEqual([]);
    });
  });

  describe('listWeightedEdges', () => {
    it('returns edges with weight, default 1', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(decodeURIComponent(req.url ?? '')).toContain('Edges?$select=ParentName,ComponentName,Weight');
        jsonResponse(res, 200, {
          value: [
            { ParentName: 'Total', ComponentName: 'A', Weight: -1 },
            { ParentName: 'Total', ComponentName: 'B' },
          ],
        });
      });
      expect(await listWeightedEdges(fakeConfig(fake.url), 'D')).toEqual([
        { parent: 'Total', child: 'A', weight: -1 },
        { parent: 'Total', child: 'B', weight: 1 },
      ]);
    });

    it('throws on non-2xx instead of returning []', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      await expect(listWeightedEdges(fakeConfig(fake.url), 'D')).rejects.toThrow(/listWeightedEdges/);
    });
  });

  describe('createDimension / deleteDimension', () => {
    it('createDimension POSTs to /Dimensions with object body', async () => {
      let observed = { method: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', body: await readBody(req) };
        res.statusCode = 201;
        res.end();
      });
      await createDimension(fakeConfig(fake.url), { Name: 'New' });
      expect(observed.method).toBe('POST');
      expect(JSON.parse(observed.body)).toEqual({ Name: 'New' });
    });

    it('createDimension accepts pre-stringified body', async () => {
      let observedBody = '';
      fake = await startFakeTm1(async (req, res) => {
        observedBody = await readBody(req);
        res.statusCode = 201;
        res.end();
      });
      await createDimension(fakeConfig(fake.url), '{"Name":"S"}');
      expect(observedBody).toBe('{"Name":"S"}');
    });

    it('deleteDimension DELETEs the dim path', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteDimension(fakeConfig(fake.url), 'D');
      expect(observed.method).toBe('DELETE');
      expect(observed.url).toContain("Dimensions('D')");
    });

    it('deleteDimension throws with custom error message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 409;
        res.end('used');
      });
      await expect(deleteDimension(fakeConfig(fake.url), 'D', 'still referenced'))
        .rejects.toThrow(/still referenced/);
    });
  });

  describe('createHierarchy / deleteHierarchy', () => {
    it('createHierarchy POSTs {Name} Hierarchies collection', async () => {
      let observed = { method: '', url: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '', body: await readBody(req) };
        res.statusCode = 201;
        res.end();
      });
      await createHierarchy(fakeConfig(fake.url), 'D', 'H');
      expect(observed.method).toBe('POST');
      expect(observed.url).toContain("Dimensions('D')/Hierarchies");
      expect(JSON.parse(observed.body)).toEqual({ Name: 'H' });
    });

    it('deleteHierarchy DELETEs the hierarchy path', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteHierarchy(fakeConfig(fake.url), 'D', 'H');
      expect(observed.method).toBe('DELETE');
      expect(observed.url).toContain("Dimensions('D')/Hierarchies('H')");
    });

    it('createHierarchy throws with custom error message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end('duplicate');
      });
      await expect(createHierarchy(fakeConfig(fake.url), 'D', 'H', 'cannot create'))
        .rejects.toThrow(/cannot create/);
    });

    it('deleteHierarchy throws with custom error message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 409;
        res.end('still in use');
      });
      await expect(deleteHierarchy(fakeConfig(fake.url), 'D', 'H', 'cannot delete'))
        .rejects.toThrow(/cannot delete/);
    });
  });

  // The four explorer CRUD helpers are called side by side from
  // registerDimensionCommands/registerCubeCommands. They must agree on where
  // the error message sits, otherwise passing one to the odd helper out
  // silently configures something else (a timeout) and the message is lost.
  // deleteCube lives in cubeApi.ts; imported here so the contract is asserted
  // in one place instead of drifting apart per file.
  describe('explorer CRUD helpers — shared argument shape', () => {
    it('all take the error message right after their object identifiers', async () => {
      fake = await startFakeTm1((req, res) => { res.statusCode = 403; res.end(); });
      const cfg = fakeConfig(fake.url);
      await expect(deleteDimension(cfg, 'D', 'msg-dim')).rejects.toThrow(/msg-dim/);
      await expect(createHierarchy(cfg, 'D', 'H', 'msg-hier-new')).rejects.toThrow(/msg-hier-new/);
      await expect(deleteHierarchy(cfg, 'D', 'H', 'msg-hier-del')).rejects.toThrow(/msg-hier-del/);
      await expect(deleteCube(cfg, 'C', 'msg-cube')).rejects.toThrow(/msg-cube/);
    });
  });
});

describe('DimensionApi (class with injectable fetch)', () => {
  function stubFetch(
    plan: Array<{ match: (m: string, p: string) => boolean; res: ApiResponse }>,
  ) {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const fn = async (method: string, path: string, body?: unknown): Promise<ApiResponse> => {
      calls.push({ method, path, body });
      const entry = plan.find(p => p.match(method, path));
      return entry?.res ?? { statusCode: 404, body: '' };
    };
    return { fn, calls };
  }

  it('createElement POSTs Element body and asserts ok', async () => {
    const { fn, calls } = stubFetch([
      { match: (m, p) => m === 'POST' && p.includes('/Elements'), res: { statusCode: 201, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.createElement('D', 'NewElem', 'N');
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ Name: 'NewElem', Type: 'Numeric' });
  });

  it('createElement maps element type code → TM1 type', async () => {
    const { fn, calls } = stubFetch([
      { match: () => true, res: { statusCode: 201, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.createElement('D', 'X', 'C');
    expect((calls[0].body as any).Type).toBe('Consolidated');
  });

  it('createElement throws with JSON error.message detail', async () => {
    const { fn } = stubFetch([
      { match: () => true, res: { statusCode: 400, body: JSON.stringify({ error: { message: 'duplicate' } }) } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await expect(api.createElement('D', 'X', 'N')).rejects.toThrow(/duplicate/);
  });

  it('createElement throws plain status when body is not JSON', async () => {
    const { fn } = stubFetch([
      { match: () => true, res: { statusCode: 500, body: '<html/>' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await expect(api.createElement('D', 'X', 'N')).rejects.toThrow(/createElement\('X'\) failed \(500\)/);
  });

  it('deleteElement issues DELETE', async () => {
    const { fn, calls } = stubFetch([
      { match: (m) => m === 'DELETE', res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.deleteElement('D', 'X');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].path).toContain("Elements('X')");
  });

  it('addEdge POSTs Edge body', async () => {
    const { fn, calls } = stubFetch([
      { match: (m) => m === 'POST', res: { statusCode: 201, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.addEdge('D', 'P', 'C', 1);
    expect(calls[0].body).toEqual({ ParentName: 'P', ComponentName: 'C', Weight: 1 });
  });

  it('deleteEdge encodes parent/child into URL key', async () => {
    const { fn, calls } = stubFetch([
      { match: (m) => m === 'DELETE', res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.deleteEdge('D', 'P', 'C');
    expect(calls[0].path).toContain("Edges(ParentName='P',ComponentName='C')");
  });

  it('setAttr POSTs Cubes/<>/tm1.Update with bound tuple', async () => {
    const { fn, calls } = stubFetch([
      { match: (m, p) => m === 'POST' && p.includes('tm1.Update'), res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'Dim', config: undefined as never });
    await api.setAttr('Dim', 'Elem', 'Alias', 'value');
    const body = calls[0].body as any;
    expect(body.Value).toBe('value');
    expect(typeof body.Value).toBe('string');
    expect(body.Cells[0]['Tuple@odata.bind']).toHaveLength(2);
    expect(calls[0].path).toContain('%7DElementAttributes_Dim');
  });

  it('setAttr sends a numeric attribute value as a JSON number, not a string', async () => {
    const { fn, calls } = stubFetch([
      { match: (m, p) => m === 'POST' && p.includes('tm1.Update'), res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'Dim', config: undefined as never });
    await api.setAttr('Dim', 'Elem', 'Numeric', 15.5);
    const body = calls[0].body as any;
    expect(body.Value).toBe(15.5);
    expect(typeof body.Value).toBe('number');
  });

  it('createHierarchy / deleteHierarchy issue POST/DELETE', async () => {
    const ops: string[] = [];
    const { fn } = stubFetch([
      { match: (m) => { ops.push(m); return true; }, res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.createHierarchy('D', 'H1');
    await api.deleteHierarchy('D', 'H1');
    expect(ops).toEqual(['POST', 'DELETE']);
  });

  it('createAttrDef / deleteAttrDef issue POST/DELETE', async () => {
    const { fn, calls } = stubFetch([
      { match: () => true, res: { statusCode: 204, body: '' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await api.createAttrDef('D', 'Alias', 'Alias');
    await api.deleteAttrDef('D', 'Alias');
    expect(calls.map(c => c.method)).toEqual(['POST', 'DELETE']);
    expect(calls[0].body).toEqual({ Name: 'Alias', Type: 'Alias' });
  });

  it('fetchSnapshot assembles dim + hierarchies + per-hier content', async () => {
    const fetchPlan: Array<{ match: (m: string, p: string) => boolean; res: ApiResponse }> = [
      { match: (m, p) => p.includes('/Hierarchies?$select=Name'),
        res: { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'D' }] }) } },
      { match: (_m, p) => p.includes('/Elements?$select=Name,Type,Attributes'),
        res: { statusCode: 200, body: JSON.stringify({ value: [
          { Name: 'E1', Type: 'Numeric', Attributes: { Alias: 'a1' } },
          { Name: 'E2', Type: 'Consolidated' },
        ] }) } },
      { match: (_m, p) => p.includes('/Edges?$select=ParentName,ComponentName,Weight'),
        res: { statusCode: 200, body: JSON.stringify({ value: [
          { ParentName: 'E2', ComponentName: 'E1', Weight: 1 },
        ] }) } },
      { match: (_m, p) => p.includes('/ElementAttributes?$select=Name,Type'),
        res: { statusCode: 200, body: JSON.stringify({ value: [
          { Name: 'Alias', Type: 'Alias' },
        ] }) } },
    ];
    const { fn } = stubFetch(fetchPlan);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    const snap = await api.fetchSnapshot('D');

    expect(snap.dimName).toBe('D');
    expect(snap.hierarchies).toEqual(['D']);
    expect(snap.perHier.D.elements).toHaveLength(2);
    expect(snap.perHier.D.elements[0]).toMatchObject({ name: 'E1', type: 'N', attrs: { Alias: 'a1' } });
    expect(snap.perHier.D.elements[1].type).toBe('C');
    expect(snap.perHier.D.edges[0]).toMatchObject({ parent: 'E2', child: 'E1', weight: 1 });
    expect(snap.perHier.D.attrDefs[0]).toMatchObject({ name: 'Alias', type: 'Alias' });
  });

  it('fetchSnapshot propagates errors with op label', async () => {
    const { fn } = stubFetch([
      { match: (_m, p) => p.includes('/Hierarchies?$select=Name'),
        res: { statusCode: 500, body: 'boom' } },
    ]);
    const api = new DimensionApi(fn, { dimName: 'D', config: undefined as never });
    await expect(api.fetchSnapshot('D')).rejects.toThrow(/fetch hierarchies failed \(500\)/);
  });
});
