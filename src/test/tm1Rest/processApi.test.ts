import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listProcesses, getProcess, getProcessParameters, getParametersOrEmpty,
  upsertProcess, updateProcess, deleteProcess,
  deployProcess, fetchProcessSections, fetchProcessUiData,
} from '../../tm1Rest/processApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('processApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('fetchProcessUiData', () => {
    // 11.8 sends "UIData": "" for every process without wizard state; the git
    // mirror writes what comes back, so "" collapsing to undefined dropped the
    // field from the header and the file no longer matched the server.
    it.each([
      ['an empty string as a value', { UIData: '' }, ''],
      ['wizard state verbatim', { UIData: 'x\fy' }, 'x\fy'],
      ['undefined only when the field is missing (TM1 12)', {}, undefined],
    ])('returns %s', async (_l, body, expected) => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, body));
      expect(await fetchProcessUiData('P', fakeConfig(fake.url))).toBe(expected);
    });
  });

  describe('listProcesses', () => {
    it('GETs Processes with default $select=Name', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'P1' }] });
      });
      const out = await listProcesses(fakeConfig(fake.url));
      expect(observedUrl).toContain('Processes?$select=Name');
      expect(out).toEqual([{ Name: 'P1' }]);
    });

    it('honors top/orderby/expand options', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listProcesses(fakeConfig(fake.url), { select: 'Name', top: 10, orderby: 'Name', expand: 'Parameters' });
      expect(observedUrl).toContain('$top=10');
      expect(observedUrl).toContain('$orderby=Name');
      expect(observedUrl).toContain('$expand=Parameters');
    });

    it('omits query string entirely when no options', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listProcesses(fakeConfig(fake.url), {});
      expect(observedUrl).toMatch(/\/Processes$/);
    });

    it('returns [] when value is missing', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, {}));
      const out = await listProcesses(fakeConfig(fake.url));
      expect(out).toEqual([]);
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      await expect(listProcesses(fakeConfig(fake.url))).rejects.toThrow();
    });
  });

  describe('getProcess / getProcessParameters', () => {
    it('GETs a single process with optional $select', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: 'P', Parameters: [{ Name: 'p1', Type: 'String', Value: '' }] });
      });
      const out = await getProcess(fakeConfig(fake.url), 'P', { select: 'Name,Parameters' });
      expect(observedUrl).toContain("Processes('P')?$select=Name,Parameters");
      expect(out.Parameters).toHaveLength(1);
    });

    // A 2xx that is not JSON (proxy/gateway page) must not become an empty process:
    // deploy and copy write the result to the target.
    it('throws on a 2xx whose body is not JSON', async () => {
      fake = await startFakeTm1((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>sign in</html>'); });
      await expect(getProcess(fakeConfig(fake.url), 'P')).rejects.toThrow();
    });

    it('getProcessParameters returns Parameters array', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { Parameters: [{ Name: 'a', Type: 'String', Value: '' }] });
      });
      const params = await getProcessParameters(fakeConfig(fake.url), 'P');
      expect(params).toEqual([{ Name: 'a', Type: 'String', Value: '' }]);
    });

    it('getProcessParameters returns [] when Parameters missing', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, {}));
      expect(await getProcessParameters(fakeConfig(fake.url), 'P')).toEqual([]);
    });
  });

  describe('getParametersOrEmpty', () => {
    it('returns parsed value array on 200', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { value: [{ Name: 'a', Type: 'String', Value: '' }] });
      });
      const out = await getParametersOrEmpty(fakeConfig(fake.url), 'P');
      expect(out).toEqual([{ Name: 'a', Type: 'String', Value: '' }]);
    });

    it('returns [] on 404', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await getParametersOrEmpty(fakeConfig(fake.url), 'P')).toEqual([]);
    });

    it('throws on non-2xx/non-404', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      await expect(getParametersOrEmpty(fakeConfig(fake.url), 'P')).rejects.toThrow();
    });
  });

  describe('upsertProcess / updateProcess / deleteProcess', () => {
    it('upsertProcess PATCHes and returns the ETag of the answer', async () => {
      const seen: string[] = [];
      fake = await startFakeTm1(async (req, res) => {
        seen.push(`${req.method} ${req.url}`);
        res.statusCode = 200;
        res.end(JSON.stringify({ '@odata.etag': 'W/"e1"' }));
      });
      expect(await upsertProcess(fakeConfig(fake.url), 'P', { PrologProcedure: 'x;' })).toBe('W/"e1"');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^PATCH .*Processes\('P'\)$/);
    });

    it('upsertProcess POSTs with Name only when the PATCH answers 404', async () => {
      const bodies: Array<{ method: string; body: string }> = [];
      fake = await startFakeTm1(async (req, res) => {
        bodies.push({ method: req.method ?? '', body: await readBody(req) });
        res.statusCode = req.method === 'PATCH' ? 404 : 201;
        res.end(req.method === 'PATCH' ? '' : JSON.stringify({ '@odata.etag': 'W/"new"' }));
      });
      expect(await upsertProcess(fakeConfig(fake.url), 'New', { PrologProcedure: 'x;' })).toBe('W/"new"');
      expect(bodies.map(b => b.method)).toEqual(['PATCH', 'POST']);
      expect(JSON.parse(bodies[1].body)).toEqual({ Name: 'New', PrologProcedure: 'x;' });
    });

    it('upsertProcess throws on any other PATCH failure instead of creating', async () => {
      const methods: string[] = [];
      fake = await startFakeTm1((req, res) => {
        methods.push(req.method ?? '');
        res.statusCode = 403;
        res.end();
      });
      await expect(upsertProcess(fakeConfig(fake.url), 'P', {})).rejects.toMatchObject({ statusCode: 403 });
      expect(methods).toEqual(['PATCH']);
    });

    it('updateProcess PATCHes /Processes(<name>)', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await updateProcess(fakeConfig(fake.url), 'P', { Description: 'x' });
      expect(observed.method).toBe('PATCH');
      expect(observed.url).toContain("Processes('P')");
    });

    it('deleteProcess DELETEs /Processes(<name>)', async () => {
      let observed = { method: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteProcess(fakeConfig(fake.url), 'P');
      expect(observed.method).toBe('DELETE');
    });

    it('deleteProcess throws with default message on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end();
      });
      await expect(deleteProcess(fakeConfig(fake.url), 'P'))
        .rejects.toThrow(/Process could not be deleted/);
    });
  });

  describe('deployProcess', () => {
    const sections = { prolog: 'P;', metadata: 'M;', data: 'D;', epilog: 'E;' };

    it('PATCHes when process already exists (GET → 200)', async () => {
      const calls: Array<{ method: string; body?: string }> = [];
      fake = await startFakeTm1(async (req, res) => {
        if (req.method === 'GET') {
          calls.push({ method: 'GET' });
          jsonResponse(res, 200, { Name: 'P' });
          return;
        }
        const body = await readBody(req);
        calls.push({ method: req.method ?? '', body });
        res.statusCode = 204;
        res.end();
      });

      await deployProcess('P', sections, undefined, undefined, undefined, fakeConfig(fake.url));
      expect(calls.map(c => c.method)).toEqual(['GET', 'PATCH']);
      const patchBody = JSON.parse(calls[1].body!);
      expect(patchBody.PrologProcedure).toBe('P;');
      expect(patchBody.MetadataProcedure).toBe('M;');
      expect(patchBody.Variables).toEqual([]);
      expect(patchBody.Name).toBeUndefined();
    });

    it('POSTs when process is missing (GET → 404)', async () => {
      const calls: Array<{ method: string; url: string; body?: string }> = [];
      fake = await startFakeTm1(async (req, res) => {
        if (req.method === 'GET') {
          calls.push({ method: 'GET', url: req.url ?? '' });
          res.statusCode = 404;
          res.end();
          return;
        }
        const body = await readBody(req);
        calls.push({ method: req.method ?? '', url: req.url ?? '', body });
        res.statusCode = 201;
        res.end();
      });

      await deployProcess('NewProc', sections, undefined, undefined, undefined, fakeConfig(fake.url));
      expect(calls.map(c => c.method)).toEqual(['GET', 'POST']);
      const postBody = JSON.parse(calls[1].body!);
      expect(postBody.Name).toBe('NewProc');
      expect(postBody.PrologProcedure).toBe('P;');
    });

    it('throws friendly auth-error on 403 PATCH', async () => {
      fake = await startFakeTm1((req, res) => {
        if (req.method === 'GET') {
          jsonResponse(res, 200, { Name: 'P' });
        } else {
          res.statusCode = 403;
          res.end();
        }
      });
      await expect(deployProcess('P', sections, undefined, undefined, undefined, fakeConfig(fake.url)))
        .rejects.toThrow(/Access denied/);
    });

    it('throws on unexpected GET status', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('weird');
      });
      await expect(deployProcess('P', sections, undefined, undefined, undefined, fakeConfig(fake.url)))
        .rejects.toThrow(/Unexpected status/);
    });

    // `[]` means "the process has no parameters any more" and MUST reach TM1:
    // omitting the property made removing the last parameter impossible — TM1 kept
    // the old ones while the editor reported a successful save. `undefined` is the
    // only value that means "leave them alone".
    it('sends an empty Parameters list, includes DataSource when provided', async () => {
      let patchBody = '';
      fake = await startFakeTm1(async (req, res) => {
        if (req.method === 'GET') {
          jsonResponse(res, 200, { Name: 'P' });
        } else {
          patchBody = await readBody(req);
          res.statusCode = 204;
          res.end();
        }
      });
      const ds = { Type: 'None' } as any;
      await deployProcess('P', sections, ds, [], [], fakeConfig(fake.url));
      const parsed = JSON.parse(patchBody);
      expect(parsed.DataSource).toEqual({ Type: 'None' });
      expect(parsed.Parameters).toEqual([]);
    });

    it('omits Parameters only when the caller passes undefined', async () => {
      let patchBody = '';
      fake = await startFakeTm1(async (req, res) => {
        if (req.method === 'GET') {
          jsonResponse(res, 200, { Name: 'P' });
        } else {
          patchBody = await readBody(req);
          res.statusCode = 204;
          res.end();
        }
      });
      await deployProcess('P', sections, undefined, undefined, [], fakeConfig(fake.url));
      expect(JSON.parse(patchBody).Parameters).toBeUndefined();
    });
  });

  describe('fetchProcessSections', () => {
    it('returns trimmed sections with CRLF → LF conversion', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, {
          PrologProcedure: 'a\r\nb\r\n',
          MetadataProcedure: 'm',
          DataProcedure: 'd',
          EpilogProcedure: 'e\n',
        });
      });
      const sec = await fetchProcessSections('P', fakeConfig(fake.url));
      expect(sec).toEqual({ prolog: 'a\nb', metadata: 'm', data: 'd', epilog: 'e' });
    });

    it('returns null on 404', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await fetchProcessSections('P', fakeConfig(fake.url))).toBeNull();
    });

    it('throws helpful message when body is not JSON', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 200;
        res.end('<html>error page</html>');
      });
      await expect(fetchProcessSections('P', fakeConfig(fake.url)))
        .rejects.toThrow(/Server response is not valid JSON/);
    });
  });
});
