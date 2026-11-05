import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildTransientProcessBody, executeTransientProcess, TransientExecError,
} from '../../tm1Rest/transientProcess';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('transientProcess', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('buildTransientProcessBody', () => {
    it('keeps the name (message-log label) and nests the definition under Process', () => {
      const body = buildTransientProcessBody({ name: '}VSCode_SaveDataAll', prolog: 'SaveDataAll;' });
      expect(body.Process.Name).toBe('}VSCode_SaveDataAll');
      expect(body.Process.PrologProcedure).toBe('#\r\nSaveDataAll;');
      expect(body.Parameters).toEqual([]);
    });

    it('emits a bare # for every omitted section', () => {
      const { Process } = buildTransientProcessBody({ name: 'X' });
      expect(Process.PrologProcedure).toBe('#');
      expect(Process.MetadataProcedure).toBe('#');
      expect(Process.DataProcedure).toBe('#');
      expect(Process.EpilogProcedure).toBe('#');
    });

    it('defaults the datasource to None and takes overrides', () => {
      expect(buildTransientProcessBody({ name: 'X' }).Process.DataSource).toEqual({ Type: 'None' });
      expect(buildTransientProcessBody({ name: 'X', dataSource: { Type: 'ASCII' } }).Process.DataSource)
        .toEqual({ Type: 'ASCII' });
    });
  });

  describe('executeTransientProcess', () => {
    it('POSTs the inline process to the unbound action — no Processes() object is touched', async () => {
      const urls: string[] = [];
      let sent = '';
      fake = await startFakeTm1(async (req, res) => {
        urls.push(`${req.method} ${req.url}`);
        sent = await readBody(req);
        jsonResponse(res, 200, { ProcessExecuteStatusCode: 'CompletedSuccessfully' });
      });
      await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X', prolog: 'SaveDataAll;' });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('POST');
      expect(urls[0]).toContain('ExecuteProcessWithReturn');
      expect(urls[0]).not.toContain('Processes(');
      expect(JSON.parse(sent).Process.PrologProcedure).toBe('#\r\nSaveDataAll;');
    });

    it('accepts a 204 (older builds return no status body)', async () => {
      fake = await startFakeTm1((_req, res) => { res.statusCode = 204; res.end(); });
      await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' })).resolves.toBeUndefined();
    });

    it('throws when the run reports minor errors', async () => {
      fake = await startFakeTm1((_req, res) => {
        jsonResponse(res, 200, { ProcessExecuteStatusCode: 'HasMinorErrors' });
      });
      await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }))
        .rejects.toThrow(/HasMinorErrors/);
    });

    it('refuses an EMPTY 200 — only 204 legitimately carries no result', async () => {
      // Live-verified, 11.8 and v12 both answer 201 WITH a ProcessExecuteResult,
      // so a body-less 200 is a proxy/gateway reply, not a TM1 status. Reporting
      // it as a successful SaveDataAll is the worst possible answer.
      fake = await startFakeTm1((_req, res) => { res.statusCode = 200; res.end('   '); });
      await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }))
        .rejects.toThrow(/empty execute response \(HTTP 200\)/);
    });

    it('accepts a 201 with a result body (the live-verified 11.8/v12 answer)', async () => {
      fake = await startFakeTm1((_req, res) => {
        jsonResponse(res, 201, { ProcessExecuteStatusCode: 'CompletedSuccessfully' });
      });
      await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' })).resolves.toBeUndefined();
    });

    it('refuses to report success on an UNPARSEABLE 200 (proxy login page)', async () => {
      // A reverse-proxy auth portal answers 200 with HTML — the old parse-safe
      // path turned that into ProcessExecuteStatusCode '' → "success", so
      // SaveDataAll/SecurityRefresh claimed to have run although nothing did.
      fake = await startFakeTm1((_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end('<!DOCTYPE html><html><body>Please log in</body></html>');
      });
      const err = await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }).catch(e => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('}VSCode_X');
      expect((err as Error).message).toMatch(/unparseable/i);
      expect((err as Error).message).toContain('Please log in');
    });

    it('appends the ErrorLog content so HasMinorErrors is diagnosable', async () => {
      const logName = 'TM1ProcessError_20260725120000_1234_}VSCode_X.log';
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('ErrorLogFiles')) {
          res.statusCode = 200;
          res.end('﻿Error: Data Source ... line 3');
          return;
        }
        jsonResponse(res, 200, {
          ProcessExecuteStatusCode: 'HasMinorErrors',
          ErrorLogFile: { Filename: logName },
        });
      });
      const err = await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }).catch(e => e);
      expect((err as Error).message).toContain('HasMinorErrors');
      expect((err as Error).message).toContain(logName);
      expect((err as Error).message).toContain('Error: Data Source ... line 3');
      expect((err as Error).message).not.toContain('﻿');
    });

    it('recovers the newest log when the answer names NO ErrorLogFile (the 11.8 case)', async () => {
      // `ExecuteProcessWithReturn` answers like `tm1.ExecuteWithReturn`: a status
      // code and no `ErrorLogFile`. Without the directory scan (shared with the
      // named path) the user got a bare "}VSCode_X: HasMinorErrors" and no way to
      // learn what actually broke — the diagnosability would be inert.
      const logName = 'TM1ProcessError_20260725120500_9_}VSCode_X.log';
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        if (url.includes("ErrorLogFiles('")) { res.statusCode = 200; res.end('Data Source line 7'); return; }
        if (url.includes('ErrorLogFiles')) {
          jsonResponse(res, 200, { value: [
            { Filename: 'TM1ProcessError_20260725120400_9_}VSCode_X.log' },   // older
            { Filename: logName },
            { Filename: 'TM1ProcessError_20260725120600_9_OtherProc.log' },   // foreign
          ] });
          return;
        }
        jsonResponse(res, 200, { ProcessExecuteStatusCode: 'HasMinorErrors' });
      });
      const err = await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }).catch(e => e);
      expect((err as Error).message).toContain(logName);
      expect((err as Error).message).toContain('Data Source line 7');
    });

    it('falls back to the legacy ErrorLogs endpoint when ErrorLogFiles/Content 404s', async () => {
      // The shared helper keeps the legacy `ErrorLogs('<n>')/tm1.GetContent`
      // route for older servers — the local copy had dropped it.
      const logName = 'TM1ProcessError_20260725120000_1234_}VSCode_X.log';
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        if (url.includes('tm1.GetContent')) { jsonResponse(res, 200, { value: 'legacy log text' }); return; }
        if (url.includes('ErrorLogFiles')) { res.statusCode = 404; res.end('nope'); return; }
        jsonResponse(res, 200, {
          ProcessExecuteStatusCode: 'HasMinorErrors',
          ErrorLogFile: logName,          // bare-string variant
        });
      });
      const err = await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }).catch(e => e);
      expect((err as Error).message).toContain('legacy log text');
    });

    it('falls back to the bare status when the ErrorLog cannot be read', async () => {
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('ErrorLogFiles')) { res.statusCode = 404; res.end('nope'); return; }
        jsonResponse(res, 200, { ProcessExecuteStatusCode: 'HasMinorErrors' });
      });
      await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }))
        .rejects.toThrow(/HasMinorErrors/);
    });

    it('throws a TransientExecError carrying the status and the OData message', async () => {
      fake = await startFakeTm1((_req, res) => {
        jsonResponse(res, 400, { error: { message: 'bad request' } });
      });
      const err = await executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' }).catch(e => e);
      expect(err).toBeInstanceOf(TransientExecError);
      expect((err as TransientExecError).statusCode).toBe(400);
      expect((err as Error).message).toBe('bad request');
    });

    it.each([403, 404, 500])(
      'never retries through a persisted helper — a %i stays a single request',
      async (status) => {
        // No fallback route exists: a retry would re-run work that may already
        // have happened (a cancelled run answers 500) and would leave a
        // `}VSCode_…` object behind.
        const urls: string[] = [];
        fake = await startFakeTm1((req, res) => {
          urls.push(`${req.method} ${req.url}`);
          res.statusCode = status;
          res.end('nope');
        });
        await expect(executeTransientProcess(fakeConfig(fake.url), { name: '}VSCode_X' })).rejects.toThrow();
        expect(urls).toHaveLength(1);
      },
    );
  });
});
