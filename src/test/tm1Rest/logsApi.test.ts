import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchProcessMessageLog } from '../../tm1Rest/logsApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('logsApi.fetchProcessMessageLog', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  function entry(ts: string, level: string, message: string) {
    return { TimeStamp: ts, Level: level, Message: message };
  }

  it('returns [] on non-2xx', async () => {
    fake = await startFakeTm1((req, res) => {
      res.statusCode = 500;
      res.end('boom');
    });
    const out = await fetchProcessMessageLog('proc', new Date(0), 200, fakeConfig(fake.url));
    expect(out).toEqual([]);
  });

  it('returns [] when body is not JSON', async () => {
    fake = await startFakeTm1((req, res) => {
      res.statusCode = 200;
      res.end('not json');
    });
    const out = await fetchProcessMessageLog('proc', new Date(0), 200, fakeConfig(fake.url));
    expect(out).toEqual([]);
  });

  it('filters by since-timestamp and case-insensitive process name in message', async () => {
    fake = await startFakeTm1((req, res) => {
      expect(req.url).toContain('MessageLogEntries');
      expect(req.url).toContain('$orderby=TimeStamp%20desc');
      expect(req.url).toContain('$top=200');
      jsonResponse(res, 200, {
        value: [
          entry('2026-05-15T10:00:00Z', 'INFO', 'MyProc started'),
          entry('2026-05-15T09:00:00Z', 'INFO', 'MyProc finished'),
          entry('2026-05-15T08:00:00Z', 'INFO', 'OtherProc started'),
          entry('2026-05-15T07:00:00Z', 'INFO', 'MyProc earlier'),
        ],
      });
    });

    const since = new Date('2026-05-15T08:30:00Z');
    const out = await fetchProcessMessageLog('myproc', since, 200, fakeConfig(fake.url));

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      timestamp: '2026-05-15T09:00:00Z',
      level: 'INFO',
      message: 'MyProc finished',
    });
    expect(out[1].message).toBe('MyProc started');
  });

  it('uppercases level and uses Timestamp/Text fallback fields', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 200, {
        value: [
          { Timestamp: '2026-05-15T10:00:00Z', Level: 'warning', Text: 'PROC happened' },
        ],
      });
    });

    const out = await fetchProcessMessageLog('proc', new Date(0), 50, fakeConfig(fake.url));
    expect(out).toEqual([
      { timestamp: '2026-05-15T10:00:00Z', level: 'WARNING', message: 'PROC happened' },
    ]);
  });

  it('returns [] when value array is missing', async () => {
    fake = await startFakeTm1((req, res) => {
      jsonResponse(res, 200, { somethingElse: 1 });
    });
    const out = await fetchProcessMessageLog('proc', new Date(0), 200, fakeConfig(fake.url));
    expect(out).toEqual([]);
  });

  it('honors custom top parameter', async () => {
    let observedUrl = '';
    fake = await startFakeTm1((req, res) => {
      observedUrl = req.url ?? '';
      jsonResponse(res, 200, { value: [] });
    });
    await fetchProcessMessageLog('proc', new Date(0), 17, fakeConfig(fake.url));
    expect(observedUrl).toContain('$top=17');
  });
});
