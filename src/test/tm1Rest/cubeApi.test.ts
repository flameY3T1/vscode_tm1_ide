import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listCubes, getCube, getCubeDimensionNames, getCubeViewNames, getCubeViews,
  getCubeRules, cubeHasRules, updateCubeRules, createCube, createView, deleteView, deleteCube,
} from '../../tm1Rest/cubeApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('cubeApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('listCubes', () => {
    it('GETs Cubes?$select=Name by default', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'C1' }] });
      });
      const out = await listCubes(fakeConfig(fake.url));
      expect(observedUrl).toContain('Cubes?$select=Name');
      expect(out).toEqual([{ Name: 'C1' }]);
    });

    it('honors top/expand options', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listCubes(fakeConfig(fake.url), { select: 'Name', top: 5, expand: 'Dimensions' });
      expect(observedUrl).toContain('$top=5');
      expect(observedUrl).toContain('$expand=Dimensions');
    });

    it('returns [] when value is missing', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, {}));
      expect(await listCubes(fakeConfig(fake.url))).toEqual([]);
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      await expect(listCubes(fakeConfig(fake.url))).rejects.toThrow();
    });
  });

  describe('getCube', () => {
    it("GETs Cubes('<name>')?$select=...", async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: 'C' });
      });
      const out = await getCube(fakeConfig(fake.url), 'C', 'Name,Dimensions');
      expect(observedUrl).toContain("Cubes('C')?$select=Name,Dimensions");
      expect(out.Name).toBe('C');
    });

    it('OData-escapes single-quote in cube name', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: "X" });
      });
      await getCube(fakeConfig(fake.url), "It's");
      expect(observedUrl).toContain("Cubes('It''s')");
    });
  });

  describe('getCubeDimensionNames', () => {
    it('returns ordered dimension names', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain("Cubes('C')/Dimensions");
        jsonResponse(res, 200, { value: [{ Name: 'Year' }, { Name: 'Period' }, { Name: 'Acct' }] });
      });
      const names = await getCubeDimensionNames(fakeConfig(fake.url), 'C');
      expect(names).toEqual(['Year', 'Period', 'Acct']);
    });
  });

  describe('getCubeViewNames', () => {
    it('GETs Views by default', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'V1' }, { Name: 'V2' }] });
      });
      const names = await getCubeViewNames(fakeConfig(fake.url), 'C');
      expect(observedUrl).toContain("Cubes('C')/Views");
      expect(names).toEqual(['V1', 'V2']);
    });

    it('GETs PrivateViews when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await getCubeViewNames(fakeConfig(fake.url), 'C', true);
      expect(observedUrl).toContain("Cubes('C')/PrivateViews");
    });

    // A server with a configured Pager caps the Views collection and hands back
    // a nextLink. Before F3 this call read page 1 only — a cube's view list came
    // back short with nothing marking the truncation.
    it('follows @odata.nextLink across every page', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        urls.push(url);
        if (url.includes('page=2')) {
          jsonResponse(res, 200, { value: [{ Name: 'V3' }] });
          return;
        }
        jsonResponse(res, 200, { value: [{ Name: 'V1' }, { Name: 'V2' }], '@odata.nextLink': 'Nx?page=2' });
      });
      const names = await getCubeViewNames(fakeConfig(fake.url), 'C');
      expect(names).toEqual(['V1', 'V2', 'V3']);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain("Cubes('C')/Views");
    });

    it('throws on non-2xx instead of returning an empty list', async () => {
      fake = await startFakeTm1((_req, res) => {
        res.statusCode = 403;
        res.end();
      });
      await expect(getCubeViewNames(fakeConfig(fake.url), 'C')).rejects.toThrow(/403/);
    });
  });

  describe('getCubeViews', () => {
    it('follows @odata.nextLink and keeps the MDX flag per page', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        urls.push(url);
        if (url.includes('page=2')) {
          jsonResponse(res, 200, {
            value: [{ Name: 'MdxOnPage2', '@odata.type': '#ibm.tm1.api.v1.MDXView' }],
          });
          return;
        }
        jsonResponse(res, 200, {
          value: [{ Name: 'Native1' }],
          '@odata.nextLink': 'Nx?page=2',
        });
      });
      const views = await getCubeViews(fakeConfig(fake.url), 'C');
      expect(views).toEqual([
        { name: 'Native1', isPrivate: false, isMdx: false },
        { name: 'MdxOnPage2', isPrivate: false, isMdx: true },
      ]);
      expect(urls).toHaveLength(2);
    });

    // Hard mode (label set): a mid-stream failure must NOT come back as a
    // silently short list — that is exactly what made the missing-views bug
    // invisible in the explorer tree.
    it('throws when a LATER page fails rather than returning the partial list', async () => {
      let n = 0;
      fake = await startFakeTm1((_req, res) => {
        n++;
        if (n === 1) {
          jsonResponse(res, 200, { value: [{ Name: 'V1' }], '@odata.nextLink': 'Nx?page=2' });
          return;
        }
        res.statusCode = 500;
        res.end();
      });
      await expect(getCubeViews(fakeConfig(fake.url), 'C')).rejects.toThrow(/500/);
    });

    it('prefixes the failing collection name onto the error', async () => {
      fake = await startFakeTm1((_req, res) => {
        res.statusCode = 401;
        res.end();
      });
      await expect(getCubeViews(fakeConfig(fake.url), 'C', true)).rejects.toThrow(/PrivateViews/);
    });
  });

  describe('getCubeRules', () => {
    it("returns '' on HTTP 204 (no rules)", async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 204;
        res.end();
      });
      const rules = await getCubeRules(fakeConfig(fake.url), 'C');
      expect(rules).toBe('');
    });

    it("returns body.value string on 200", async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { '@odata.context': 'ctx', value: '[Rule] = N: 1;\n' });
      });
      const rules = await getCubeRules(fakeConfig(fake.url), 'C');
      expect(rules).toBe('[Rule] = N: 1;\n');
    });

    it("returns '' when value is non-string", async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, { value: 42 }));
      expect(await getCubeRules(fakeConfig(fake.url), 'C')).toBe('');
    });

    it("throws on unparseable 200 body (no silent '' → prevents rule-loss on save)", async () => {
      // A malformed/truncated 200 body (overloaded server) must NOT degrade to
      // '' — that is indistinguishable from "no rules" and, if the user saves
      // the blank editor, PATCH would wipe the cube's real rules. Genuine
      // no-rules comes back as 204 (asserted above). See getCubeRules strict parse.
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 200;
        res.end('not json');
      });
      await expect(getCubeRules(fakeConfig(fake.url), 'C')).rejects.toThrow();
    });
  });

  describe('cubeHasRules', () => {
    it('asks with the rules filter instead of fetching the rules text', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(decodeURIComponent(req.url ?? ''));
        jsonResponse(res, 200, { value: [{ Name: "O'C" }] });
      });
      expect(await cubeHasRules(fakeConfig(fake.url), "O'C")).toBe(true);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("$filter=Name eq 'O''C' and Rules ne null");
    });

    it('answers false when the filter names nothing', async () => {
      fake = await startFakeTm1((_req, res) => jsonResponse(res, 200, { value: [] }));
      expect(await cubeHasRules(fakeConfig(fake.url), 'C')).toBe(false);
    });
  });

  describe('updateCubeRules', () => {
    it("PATCHes Cubes('<name>') with {Rules: <text>}", async () => {
      let observed = { method: '', url: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '', body: await readBody(req) };
        res.statusCode = 204;
        res.end();
      });
      await updateCubeRules(fakeConfig(fake.url), 'C', '[X] = 1;');
      expect(observed.method).toBe('PATCH');
      expect(observed.url).toContain("Cubes('C')");
      expect(JSON.parse(observed.body)).toEqual({ Rules: '[X] = 1;' });
    });

    it('throws on non-2xx with custom message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end();
      });
      await expect(updateCubeRules(fakeConfig(fake.url), 'C', 'r', 'oops'))
        .rejects.toThrow(/oops/);
    });
  });

  describe('createCube', () => {
    it('POSTs body to /Cubes', async () => {
      let observed = { method: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', body: await readBody(req) };
        res.statusCode = 201;
        res.end();
      });
      await createCube(fakeConfig(fake.url), { Name: 'New', Dimensions: [{ Name: 'D1' }] });
      expect(observed.method).toBe('POST');
      expect(JSON.parse(observed.body).Name).toBe('New');
    });

    it('accepts pre-stringified body', async () => {
      let observedBody = '';
      fake = await startFakeTm1(async (req, res) => {
        observedBody = await readBody(req);
        res.statusCode = 201;
        res.end();
      });
      await createCube(fakeConfig(fake.url), '{"Name":"S"}');
      expect(observedBody).toBe('{"Name":"S"}');
    });
  });

  describe('createView', () => {
    it('POSTs to Cubes/<>/Views', async () => {
      let observed = { url: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { url: req.url ?? '', body: await readBody(req) };
        res.statusCode = 201;
        res.end();
      });
      await createView(fakeConfig(fake.url), 'C', { Name: 'V' });
      expect(observed.url).toContain("Cubes('C')/Views");
      expect(JSON.parse(observed.body)).toEqual({ Name: 'V' });
    });

    it('uses PrivateViews when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 201;
        res.end();
      });
      await createView(fakeConfig(fake.url), 'C', { Name: 'V' }, true);
      expect(observedUrl).toContain("Cubes('C')/PrivateViews");
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end();
      });
      await expect(createView(fakeConfig(fake.url), 'C', {})).rejects.toThrow(/View could not be created/);
    });
  });

  describe('deleteView', () => {
    it("DELETEs Cubes/<>/Views('<v>')", async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteView(fakeConfig(fake.url), 'C', 'V');
      expect(observed.method).toBe('DELETE');
      expect(observed.url).toContain("Views('V')");
    });

    it('uses PrivateViews when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 204;
        res.end();
      });
      await deleteView(fakeConfig(fake.url), 'C', 'V', true);
      expect(observedUrl).toContain("PrivateViews('V')");
    });

    it('throws on non-2xx with custom message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end();
      });
      await expect(deleteView(fakeConfig(fake.url), 'C', 'V', false, undefined, 'denied'))
        .rejects.toThrow(/denied/);
    });
  });

  describe('deleteCube', () => {
    it('DELETEs the cube path', async () => {
      let method = '';
      let url = '';
      fake = await startFakeTm1((req, res) => {
        method = req.method ?? '';
        url = req.url ?? '';
        res.statusCode = 204;
        res.end();
      });
      await deleteCube(fakeConfig(fake.url), 'Sales');
      expect(method).toBe('DELETE');
      expect(url).toContain("Cubes('Sales')");
    });

    it('encodes a single quote in the cube name', async () => {
      let url = '';
      fake = await startFakeTm1((req, res) => { url = req.url ?? ''; res.statusCode = 204; res.end(); });
      await deleteCube(fakeConfig(fake.url), "O'Brien");
      expect(url).toContain("O''Brien");
    });

    it('surfaces the TM1 message when the cube is still referenced', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 400, {
        error: { message: "Cube 'Sales' cannot be deleted because it is used" },
      }));
      await expect(deleteCube(fakeConfig(fake.url), 'Sales'))
        .rejects.toThrow(/cannot be deleted because it is used/);
    });

    // Signature parity with deleteDimension/createHierarchy/deleteHierarchy in
    // dimensionApi.ts: the third argument is the error message, not a timeout.
    it('takes the error message as its third argument, like the dimension helpers', async () => {
      fake = await startFakeTm1((req, res) => { res.statusCode = 403; res.end(); });
      await expect(deleteCube(fakeConfig(fake.url), 'Sales', 'Cube could not be deleted'))
        .rejects.toThrow(/Cube could not be deleted/);
    });
  });
});
