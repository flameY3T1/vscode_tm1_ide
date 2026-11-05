import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listFiles, downloadFile, uploadFile, replaceFile, deleteFile, isUserFile, folderPath,
} from '../../tm1Rest/filesApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('isUserFile', () => {
  const cubes = new Set(['planung', 'c1']);
  it.each([
    ['}ClientSettings'],
    ['}PickList_Planung'],
    ['Portal.xlsx_20210311090835.xlsx'],
    ['Portal_20260211164315.xlsm'],
    ['C1'],
    ['Planung.Standard'],
    ['Planung.Ansicht.benutzer'],
    ['Geloescht.Planungsstand Investitionen.benutzer'],
    ['Geloescht'],
  ])('hides TM1-owned entry %s', (name) => {
    expect(isUserFile(name, cubes)).toBe(false);
  });
  it.each([['export.csv'], ['notes.txt'], ['daten.2026.xlsx']])('keeps %s', (name) => {
    expect(isUserFile(name, cubes)).toBe(true);
  });
});

describe('filesApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('listFiles', () => {
    it('returns mapped Documents and Folders', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain("Contents('Blobs')/Contents");
        jsonResponse(res, 200, {
          value: [
            { '@odata.type': '#ibm.tm1.api.v1.Document', Name: 'a.txt', ID: 'a.txt', Size: 12, LastUpdated: '2026-05-15T10:00:00Z' },
            { '@odata.type': '#ibm.tm1.api.v1.Folder',   Name: 'sub',    ID: 'sub' },
            { Name: 'b.txt', ID: 'b.txt', Size: 99 },
          ],
        });
      });
      const files = await listFiles(fakeConfig(fake.url));
      expect(files).toEqual([
        { Name: 'a.txt', Size: 12, LastUpdated: '2026-05-15T10:00:00Z' },
        { Name: 'sub', Size: undefined, LastUpdated: undefined, isFolder: true },
        { Name: 'b.txt', Size: 99, LastUpdated: undefined },
      ]);
    });

    it('addresses Files with folder path on v12, flat Blobs on v11', () => {
      expect(folderPath({ version: 'v12' }, ['tmp', "it's"])).toBe("Contents('Files')/Contents('tmp')/Contents('it''s')");
      expect(folderPath({ version: 'v11' }, [])).toBe("Contents('Blobs')");
      expect(folderPath({}, [])).toBe("Contents('Blobs')");
    });

    it('returns [] when value is missing/non-array', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, { value: null }));
      expect(await listFiles(fakeConfig(fake.url))).toEqual([]);
    });

    it('throws on non-2xx with operation prefix', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      await expect(listFiles(fakeConfig(fake.url))).rejects.toThrow(/Load files failed \(HTTP 500\)/);
    });
  });

  describe('downloadFile', () => {
    it('returns binary buffer from /Content', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.url).toContain("/Content");
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(Buffer.from([0x01, 0x02, 0x03, 0x04]));
      });
      const buf = await downloadFile('bin.dat', fakeConfig(fake.url));
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.toString('hex')).toBe('01020304');
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end('missing');
      });
      await expect(downloadFile('missing.bin', fakeConfig(fake.url)))
        .rejects.toThrow(/Load file "missing.bin" failed/);
    });
  });

  describe('uploadFile', () => {
    it('POSTs Document creation then PUTs Content', async () => {
      const log: Array<{ method: string; url: string; body?: string }> = [];
      fake = await startFakeTm1(async (req, res) => {
        const url = req.url ?? '';
        if (req.method === 'POST') {
          const body = await readBody(req);
          log.push({ method: 'POST', url, body });
          res.statusCode = 201;
          res.end('{}');
        } else if (req.method === 'PUT') {
          const body = await readBody(req);
          log.push({ method: 'PUT', url, body });
          res.statusCode = 204;
          res.end();
        } else {
          res.statusCode = 405;
          res.end();
        }
      });

      await uploadFile('hello.txt', Buffer.from('payload'), fakeConfig(fake.url));

      expect(log).toHaveLength(2);
      expect(log[0].method).toBe('POST');
      expect(log[0].url).toContain("Contents('Blobs')/Contents");
      expect(JSON.parse(log[0].body!)).toEqual({
        '@odata.type': '#ibm.tm1.api.v1.Document',
        Name: 'hello.txt',
        ID: 'hello.txt',
      });
      expect(log[1].method).toBe('PUT');
      expect(log[1].url).toContain('/Content');
      expect(log[1].body).toBe('payload');
    });

    it('treats 409 on create as already-exists and continues to PUT', async () => {
      let putCalled = false;
      fake = await startFakeTm1((req, res) => {
        if (req.method === 'POST') {
          res.statusCode = 409;
          res.end('exists');
        } else if (req.method === 'PUT') {
          putCalled = true;
          res.statusCode = 204;
          res.end();
        }
      });
      await uploadFile('again.txt', Buffer.from('x'), fakeConfig(fake.url));
      expect(putCalled).toBe(true);
    });

    it('throws when POST returns unexpected non-2xx/409', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      await expect(uploadFile('bad.txt', Buffer.from('x'), fakeConfig(fake.url)))
        .rejects.toThrow(/Create file "bad.txt" failed/);
    });
  });

  describe('replaceFile', () => {
    it('PUTs to /Content with octet-stream header', async () => {
      let observedCT = '';
      let observedBody = '';
      fake = await startFakeTm1(async (req, res) => {
        observedCT = (req.headers['content-type'] ?? '') as string;
        observedBody = await readBody(req);
        res.statusCode = 204;
        res.end();
      });
      await replaceFile('r.txt', Buffer.from('new-content'), fakeConfig(fake.url));
      expect(observedCT).toBe('application/octet-stream');
      expect(observedBody).toBe('new-content');
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end('rej');
      });
      await expect(replaceFile('x.txt', Buffer.from('a'), fakeConfig(fake.url)))
        .rejects.toThrow(/Replace file "x.txt" failed/);
    });
  });

  describe('deleteFile', () => {
    it('sends DELETE to blob path', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteFile('dead.txt', fakeConfig(fake.url));
      expect(observed.method).toBe('DELETE');
      expect(observed.url).toContain("Contents('Blobs')/Contents('dead.txt')");
    });

    it('escapes single-quotes in name (OData key escape)', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 204;
        res.end();
      });
      await deleteFile("it's.txt", fakeConfig(fake.url));
      expect(observedUrl).toContain("it''s.txt");
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end('forbidden');
      });
      await expect(deleteFile('x.txt', fakeConfig(fake.url)))
        .rejects.toThrow(/Delete file "x.txt" failed/);
    });
  });
});
