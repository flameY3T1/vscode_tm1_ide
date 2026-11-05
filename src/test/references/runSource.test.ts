import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.hoisted`: the `vi.mock` factories run BEFORE the module constants of this
// file — a `const apiRequest` declared directly here would still be in the
// temporal dead zone inside the factory.
//
// BOTH paths on the same double: `references/` imports the transport
// directly from `tm1Rest/client` (depcruise forbids the facade to deep layers),
// so a test that only mocks the facade would run into the real network.
const { apiRequest, listRunLogFiles, readRunLogContent } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  listRunLogFiles: vi.fn(),
  readRunLogContent: vi.fn(),
}));
vi.mock('../../tm1Rest/client', () => ({ apiRequest }));
vi.mock('../../tm1Client', () => ({ apiRequest }));
vi.mock('../../messageLog/messageLogV12', () => ({
  listRunLogFiles,
  readRunLogContentForFile: readRunLogContent,
}));

import { listRuns, loadRun } from '../../references/runSource';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const cfg = { serverUrl: 'https://x', username: 'u', password: 'p', authType: 'Basic' } as unknown as Tm1Config;

function antwort(value: unknown[]): { statusCode: number; body: string } {
  return { statusCode: 200, body: JSON.stringify({ value }) };
}

beforeEach(() => { apiRequest.mockReset(); });

describe('listRuns (v11)', () => {
  it('queries filtered on the server side and returns the run heads', async () => {
    // Newest first — exactly the order that `$orderby=TimeStamp desc`
    // returns and that `analyze()` expects.
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:12Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Prozess "Load_All":  Ausführung normal beendet, verstrichene Zeit 4.04 Sekunden' },
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by user "n"' },
    ]));
    const runs = await listRuns('Load_All', cfg);
    const pfad = String(apiRequest.mock.calls[0][1]);
    expect(pfad).toContain('MessageLogEntries');
    expect(decodeURIComponent(pfad)).toContain("contains(tolower(Message),'load_all')");
    expect(decodeURIComponent(pfad)).toContain("Logger eq 'TM1.Process'");
    expect(runs).toHaveLength(1);
    expect(runs[0].elapsedSec).toBe(4.04);
    expect(runs[0].status).toBe('ok');
    expect(runs[0].threadId).toBe(7);
    expect(runs[0].originator).toBe('n');
  });

  it('reports a running process as running', async () => {
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by user "n"' },
    ]));
    const runs = await listRuns('Load_All', cfg);
    expect(runs[0].status).toBe('running');
    expect(runs[0].elapsedSec).toBeNull();
  });

  it('takes the chore as originator when no user is given', async () => {
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by chore "Nightly"' },
    ]));
    expect((await listRuns('Load_All', cfg))[0].originator).toBe('Nightly');
  });

  it('discards foreign names that merely contain the name', async () => {
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All_Extra" executed by user "n"' },
    ]));
    expect(await listRuns('Load_All', cfg)).toEqual([]);
  });

  it('returns an empty list when nothing was found', async () => {
    apiRequest.mockResolvedValueOnce(antwort([]));
    expect(await listRuns('Load_All', cfg)).toEqual([]);
  });

  it('returns an empty list when the server rejects the query', async () => {
    apiRequest.mockResolvedValueOnce({ statusCode: 400, body: 'nope' });
    expect(await listRuns('Load_All', cfg)).toEqual([]);
  });
});

describe('loadRun (v11)', () => {
  it('fetches the time window and returns the tree of the root', async () => {
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:12Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Prozess "Load_All":  Ausführung normal beendet, verstrichene Zeit 4.04 Sekunden' },
      { TimeStamp: '2026-08-26T07:00:10Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Prozess "Kind":  Ausführung normal beendet, verstrichene Zeit 1.00 Sekunden' },
      { TimeStamp: '2026-08-26T07:00:09Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Kind" run from process "Load_All" by user "n"' },
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by user "n"' },
    ]));
    const { tree, roots: wurzeln } = await loadRun('Load_All', {
      startedAt: '2026-08-26T07:00:08Z', elapsedSec: 4.04, status: 'ok', threadId: 7,
    }, cfg);
    expect(tree?.name).toBe('Load_All');
    expect(tree?.children.map(c => c.name)).toEqual(['Kind']);
    // The roots of the window are part of the result — the base set for the
    // asynchronous edges.
    expect(wurzeln.length).toBeGreaterThanOrEqual(1);
    expect(wurzeln[0].originator).toBe('n');
    const pfad = decodeURIComponent(String(apiRequest.mock.calls[0][1]));
    expect(pfad).toContain('TimeStamp ge');
    expect(pfad).toContain('TimeStamp le');
    // Descending is contract, not taste: `analyze()` reverses whatever it
    // receives — fetched ascending, every end line would come before its start.
    expect(pfad).toContain('$orderby=TimeStamp desc');
  });

  it('picks, among runs of the same name, the one with the matching start', async () => {
    apiRequest.mockResolvedValueOnce(antwort([
      { TimeStamp: '2026-08-26T07:00:22Z', ThreadID: 9, Logger: 'TM1.Process',
        Message: 'Prozess "Load_All":  Ausführung normal beendet, verstrichene Zeit 2.00 Sekunden' },
      { TimeStamp: '2026-08-26T07:00:20Z', ThreadID: 9, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by user "b"' },
      { TimeStamp: '2026-08-26T07:00:12Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Prozess "Load_All":  Ausführung normal beendet, verstrichene Zeit 4.04 Sekunden' },
      { TimeStamp: '2026-08-26T07:00:08Z', ThreadID: 7, Logger: 'TM1.Process',
        Message: 'Process "Load_All" executed by user "a"' },
    ]));
    const { tree } = await loadRun('Load_All', {
      startedAt: '2026-08-26T07:00:20Z', elapsedSec: 2, status: 'ok', threadId: 9,
    }, cfg);
    expect(tree?.startTs).toBe('2026-08-26T07:00:20Z');
    expect(tree?.elapsedSec).toBe(2);
  });

  it('leaves the window open at the top while the run is still running', async () => {
    apiRequest.mockResolvedValueOnce(antwort([]));
    await loadRun('Load_All', {
      startedAt: '2026-08-26T07:00:08Z', elapsedSec: null, status: 'running',
    }, cfg);
    const pfad = decodeURIComponent(String(apiRequest.mock.calls[0][1]));
    const bis = /TimeStamp le ([^\s&]+)/.exec(pfad)?.[1] ?? '';
    expect(Date.parse(bis)).toBeGreaterThan(Date.parse('2026-08-26T07:00:08Z'));
  });
});

describe('v12 — one file is one run', () => {
  const v12cfg = { ...cfg, version: 'v12' } as unknown as Tm1Config;

  beforeEach(() => { listRunLogFiles.mockReset(); readRunLogContent.mockReset(); });

  it('takes the files of the process as run heads', async () => {
    listRunLogFiles.mockResolvedValueOnce([
      { filename: 'ProcessLog_20260826070009_1_Load_All.jsonl', kind: 'process', object: 'Load_All', startedAt: '2026-08-26T07:00:09Z' },
      { filename: 'ProcessLog_20260826060011_1_Andere.jsonl', kind: 'process', object: 'Andere', startedAt: '2026-08-26T06:00:11Z' },
    ]);
    const runs = await listRuns('Load_All', v12cfg);
    expect(runs).toHaveLength(1);
    expect(runs[0].startedAt).toBe('2026-08-26T07:00:09Z');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('reads exactly one file for the tree', async () => {
    listRunLogFiles.mockResolvedValueOnce([
      { filename: 'ProcessLog_20260826070009_1_Load_All.jsonl', kind: 'process', object: 'Load_All', startedAt: '2026-08-26T07:00:09Z' },
    ]);
    readRunLogContent.mockResolvedValueOnce([
      { TimeStamp: '2026-08-26T07:00:09Z', Name: 'Load_All', Message: 'Process "Load_All" executed by user "n"' },
      { TimeStamp: '2026-08-26T07:00:13Z', Name: 'Load_All', Message: 'Process execution finished normally.' },
    ]);
    const { tree } = await loadRun('Load_All', {
      startedAt: '2026-08-26T07:00:09Z', elapsedSec: null, status: 'ok',
    }, v12cfg);
    expect(tree?.name).toBe('Load_All');
    expect(readRunLogContent).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when the file for the head is missing', async () => {
    listRunLogFiles.mockResolvedValueOnce([]);
    expect(await loadRun('Load_All', {
      startedAt: '2026-08-26T07:00:09Z', elapsedSec: null, status: 'ok',
    }, v12cfg)).toEqual({ tree: null, roots: [] });
    expect(readRunLogContent).not.toHaveBeenCalled();
  });
});
