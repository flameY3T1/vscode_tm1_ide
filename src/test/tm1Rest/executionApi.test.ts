import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeProcess, fetchErrorLog, classifyExecuteStatus, countLogEntries, condenseProcessLogJsonl } from '../../tm1Rest/executionApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, readBody, jsonResponse, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('executionApi.executeProcess', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  it('returns Successful on HTTP 204 (legacy success)', async () => {
    fake = await startFakeTm1((req, res) => {
      expect(req.method).toBe('POST');
      expect(req.url).toContain("Processes('MyProc')/tm1.Execute");
      res.statusCode = 204;
      res.end();
    });

    const result = await executeProcess('MyProc', [], fakeConfig(fake.url));
    expect(result.status).toBe('Successful');
    expect(result.errorMessage).toBeUndefined();
  });

  it('sends Parameters in JSON body and URL-encodes process name', async () => {
    let observedBody = '';
    let observedUrl = '';
    fake = await startFakeTm1(async (req, res) => {
      observedUrl = req.url ?? '';
      observedBody = await readBody(req);
      res.statusCode = 204;
      res.end();
    });

    await executeProcess(
      'Proc With Space',
      [{ Name: 'p1', Value: 42 }, { Name: 'p2', Value: 'hi' }],
      fakeConfig(fake.url),
    );

    expect(observedUrl).toContain('Proc%20With%20Space');
    expect(JSON.parse(observedBody)).toEqual({
      Parameters: [{ Name: 'p1', Value: 42 }, { Name: 'p2', Value: 'hi' }],
    });
  });

  it('parses ProcessExecuteStatusCode from HTTP 200 body', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 200, { ProcessExecuteStatusCode: 'CompletedWithMessages' });
    });

    const result = await executeProcess('P', [], fakeConfig(fake.url));
    expect(result.status).toBe('CompletedWithMessages');
    expect(result.errorMessage).toBeUndefined();
  });

  it('fetches ErrorLog content when ErrorLogFile.Filename is set', async () => {
    fake = await startFakeTm1((req, res) => {
      if (req.url?.includes('tm1.Execute')) {
        jsonResponse(res, 200, {
          ProcessExecuteStatusCode: 'CompletedWithMessages',
          ErrorLogFile: { Filename: 'err.log' },
        });
      } else if (req.url?.includes("ErrorLogs('err.log')/tm1.GetContent")) {
        jsonResponse(res, 200, { Content: 'TI ERROR: something' });
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const result = await executeProcess('P', [], fakeConfig(fake.url));
    expect(result.status).toBe('CompletedWithMessages');
    expect(result.errorMessage).toBe('TI ERROR: something');
  });

  it('returns Unknown (not Successful) when 200 body is not valid JSON', async () => {
    fake = await startFakeTm1((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end('<html>gateway error</html>');
    });

    const result = await executeProcess('P', [], fakeConfig(fake.url));
    // Fail-safe: an unparsable 200 must NOT pass as success
    expect(result.status).toBe('Unknown');
    expect(result.errorMessage).toContain('Unparseable execute response');
    expect(result.errorMessage).toContain('gateway error');
  });

  it('throws on non-2xx with parsed error.message', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 500, { error: { message: 'TI rule compile failed' } });
    });

    await expect(executeProcess('Broken', [], fakeConfig(fake.url)))
      .rejects.toThrow(/HTTP 500: TI rule compile failed/);
  });

  it('throws on non-2xx with Message field', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 400, { Message: 'Bad parameter' });
    });

    await expect(executeProcess('P', [], fakeConfig(fake.url)))
      .rejects.toThrow(/HTTP 400: Bad parameter/);
  });

  it('throws on non-2xx with non-JSON body (uses raw body)', async () => {
    fake = await startFakeTm1((req, res) => {
      res.statusCode = 500;
      res.end('Internal Server Error');
    });

    await expect(executeProcess('P', [], fakeConfig(fake.url)))
      .rejects.toThrow(/HTTP 500: Internal Server Error/);
  });

  it('recovers newest TM1ProcessError log for the process when ErrorLogFile is absent', async () => {
    fake = await startFakeTm1((req, res) => {
      const url = req.url ?? '';
      if (url.includes('tm1.ExecuteWithReturn')) {
        // Server reports minor errors but omits ErrorLogFile (TM1 11.8 quirk).
        jsonResponse(res, 200, { ProcessExecuteStatusCode: 'HasMinorErrors' });
      } else if (url.includes('/Content')) {
        // Echo which file was fetched so the test can assert the pick.
        const m = /ErrorLogFiles\('([^']+)'\)/.exec(decodeURIComponent(url));
        res.statusCode = 200;
        res.end(`content of ${m?.[1] ?? '?'}`);
      } else if (url.includes('ErrorLogFiles')) {
        jsonResponse(res, 200, {
          value: [
            { Filename: 'TM1ProcessError_20260715120000_30411340_Import.log' },
            { Filename: 'TM1ProcessError_20260715191629_30411340_Import.log' },
            // Collision bait: newer timestamp, but a DIFFERENT process whose name
            // ends in "_Import" — must NOT be selected for process "Import".
            { Filename: 'TM1ProcessError_20260715235959_99999999_Reporting_Import.log' },
          ],
        });
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const result = await executeProcess('Import', [], fakeConfig(fake.url));
    expect(result.severity).toBe('minor');
    expect(result.logFilename).toBe('TM1ProcessError_20260715191629_30411340_Import.log');
    expect(result.errorMessage).toBe('content of TM1ProcessError_20260715191629_30411340_Import.log');
  });

  it('ignores ErrorLog fetch failures (returns status without errorMessage)', async () => {
    fake = await startFakeTm1((req, res) => {
      if (req.url?.includes('tm1.Execute')) {
        jsonResponse(res, 200, {
          ProcessExecuteStatusCode: 'CompletedWithMessages',
          ErrorLogFile: { Filename: 'missing.log' },
        });
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const result = await executeProcess('P', [], fakeConfig(fake.url));
    expect(result.status).toBe('CompletedWithMessages');
    expect(result.severity).toBe('minor');
    expect(result.errorMessage).toBeUndefined();
  });

  it('derives minorCount from the ErrorLog line count on minor runs', async () => {
    fake = await startFakeTm1((req, res) => {
      if (req.url?.includes('tm1.Execute')) {
        jsonResponse(res, 200, {
          ProcessExecuteStatusCode: 'HasMinorErrors',
          ErrorLogFile: { Filename: 'err.log' },
        });
      } else if (req.url?.includes('/Content')) {
        // 3 real entries + a blank line + trailing newline → count must be 3.
        res.statusCode = 200;
        res.end('entry one\nentry two\n\nentry three\n');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });

    const result = await executeProcess('P', [], fakeConfig(fake.url));
    expect(result.severity).toBe('minor');
    expect(result.minorCount).toBe(3);
  });

  it('leaves minorCount undefined on clean success', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 200, { ProcessExecuteStatusCode: 'CompletedSuccessfully' });
    });
    const result = await executeProcess('P', [], fakeConfig(fake.url));
    expect(result.severity).toBe('success');
    expect(result.minorCount).toBeUndefined();
  });

  it('throws a plain "server not ready" hint on HTTP 503', async () => {
    fake = await startFakeTm1((req, res) => {
      res.statusCode = 503;
      res.end('<html>Service Unavailable</html>');
    });
    await expect(executeProcess('P', [], fakeConfig(fake.url)))
      .rejects.toThrow(/server not ready \(HTTP 503\)/);
  });
});

describe('countLogEntries', () => {
  it('counts non-empty lines, ignoring blanks and trailing newline', () => {
    expect(countLogEntries('a\nb\nc\n')).toBe(3);
    expect(countLogEntries('a\n\n\nb\n')).toBe(2);
    expect(countLogEntries('single line no newline')).toBe(1);
  });
  it('returns undefined for empty or missing content', () => {
    expect(countLogEntries(undefined)).toBeUndefined();
    expect(countLogEntries('')).toBeUndefined();
    expect(countLogEntries('\n\n  \n')).toBeUndefined();
  });
});

describe('classifyExecuteStatus', () => {
  it('maps clean-success codes to success', () => {
    expect(classifyExecuteStatus('CompletedSuccessfully')).toBe('success');
    expect(classifyExecuteStatus('Successful')).toBe('success');
    expect(classifyExecuteStatus('')).toBe('success');
  });
  it('maps minor-error codes to minor', () => {
    expect(classifyExecuteStatus('HasMinorErrors')).toBe('minor');
    expect(classifyExecuteStatus('CompletedWithMessages')).toBe('minor');
  });
  it('maps everything else to major', () => {
    expect(classifyExecuteStatus('Aborted')).toBe('major');
    expect(classifyExecuteStatus('CompletedWithFailure')).toBe('major');
    expect(classifyExecuteStatus('whatever')).toBe('major');
  });
});

describe('condenseProcessLogJsonl', () => {
  // Shape captured live from v12 (ProcessLog_<ts>_<id>_<proc>.jsonl), 2026-07-26.
  const V12_LOG = [
    '{"id":1,"level":"info","timestamp":"2026-07-26T07:45:22.289Z","name":"}p","message":"Process \\"}p\\" executed by user \\"Admin\\"."}',
    '{"id":1,"level":"error","timestamp":"2026-07-26T07:45:22.291Z","name":"}p","message":"Error: Prolog procedure line (0): Unable to open data source \'C:\\\\x.txt\'. "}',
    '{"id":1,"level":"info","timestamp":"2026-07-26T07:45:22.292Z","name":"}p","message":"Process execution aborted with errors."}',
  ].join('\n');

  it('keeps the error line and drops the info bookkeeping', () => {
    expect(condenseProcessLogJsonl(V12_LOG))
      .toBe("Error: Prolog procedure line (0): Unable to open data source 'C:\\x.txt'.");
  });

  it('falls back to every message when the log holds no error/warn entry', () => {
    const infoOnly = '{"level":"info","message":"first"}\n{"level":"info","message":"second"}';
    expect(condenseProcessLogJsonl(infoOnly)).toBe('first\nsecond');
  });

  it('leaves a v11 plain-text log untouched', () => {
    const plain = 'Fehler: Prolog Prozedurzeile (0): Unable to open data source "C:\\x.txt".\r\n';
    expect(condenseProcessLogJsonl(plain)).toBe(plain);
  });

  it('leaves half-JSON garbage untouched rather than losing it', () => {
    const broken = '{"level":"error","message":"ok"}\n{not json';
    expect(condenseProcessLogJsonl(broken)).toBe(broken);
    expect(condenseProcessLogJsonl('')).toBe('');
  });
});

describe('executionApi.fetchErrorLog', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  // B11: the apostrophe has to be doubled INSIDE the key literal, otherwise
  // it breaks open. The legacy branch below did it right from the start,
  // the main branch used `encodeURIComponent` — which leaves `'` untouched.
  it("doubles an apostrophe in the file name", async () => {
    let observedUrl = '';
    fake = await startFakeTm1((req, res) => {
      observedUrl = req.url ?? '';
      res.statusCode = 200;
      res.end('log line');
    });

    const text = await fetchErrorLog(fakeConfig(fake.url), "TM1ProcessError_o'brien.log");

    expect(text).toBe('log line');
    expect(decodeURIComponent(observedUrl)).toContain("ErrorLogFiles('TM1ProcessError_o''brien.log')/Content");
  });
});
