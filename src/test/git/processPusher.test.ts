import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the network is faked; assertOk stays real so errors keep their shape.
vi.mock('../../tm1Rest/client', async (orig) => ({
  ...(await orig<typeof import('../../tm1Rest/client')>()),
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { pushProcess } from '../../git/processPusher';
import type { TM1Process } from '../../git/serializer';

const mockApi = vi.mocked(apiRequest);
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

beforeEach(() => { mockApi.mockReset(); });

function makeProcess(overrides: Partial<TM1Process> = {}): TM1Process {
  return {
    name: 'TestProc',
    prolog: 'sP();',
    metadata: '',
    data: 'sD();',
    epilog: '',
    parameters: [],
    variables: [],
    dataSource: { Type: 'None' },
    hasSecurity: false,
    ...overrides,
  };
}

describe('processPusher', () => {
  it('PATCHes Processes(...) directly, without a GET first', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

    await pushProcess(makeProcess(), CFG);

    expect(mockApi).toHaveBeenCalledTimes(1);
    const [m0, p0, body0] = mockApi.mock.calls[0];
    expect(m0).toBe('PATCH');
    expect(p0).toContain("Processes('TestProc')");
    const payload = JSON.parse(body0 as string);
    expect(payload.PrologProcedure).toBe('sP();');
    expect(payload.DataProcedure).toBe('sD();');
    expect(payload.MetadataProcedure).toBe('');
    expect(payload.EpilogProcedure).toBe('');
    expect(payload.Name).toBeUndefined();
    expect(payload.Variables).toEqual([]);
    expect(payload.HasSecurityAccess).toBe(false);
  });

  it('restores HasSecurityAccess on push (git import roundtrip)', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

    await pushProcess(makeProcess({ hasSecurity: true }), CFG);

    const payload = JSON.parse(mockApi.mock.calls[0][2] as string);
    expect(payload.HasSecurityAccess).toBe(true);
  });

  it('POSTs to /Processes when the PATCH answers 404', async () => {
    mockApi
      .mockResolvedValueOnce({ statusCode: 404, body: '' } as any)
      .mockResolvedValueOnce({ statusCode: 201, body: '{}' } as any);

    await pushProcess(makeProcess({ name: 'NewProc' }), CFG);

    expect(mockApi).toHaveBeenCalledTimes(2);
    const [m1, p1, body1] = mockApi.mock.calls[1];
    expect(m1).toBe('POST');
    expect(p1).toBe('Processes');
    expect(JSON.parse(body1 as string).Name).toBe('NewProc');
  });

  it('throws a 412 Tm1HttpError on a stale ETag', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 412, body: '{"error":{"code":"278","message":""}}' } as any);

    await expect(pushProcess(makeProcess(), CFG, 'W/"old"')).rejects.toMatchObject({ statusCode: 412 });
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('sends a remembered ETag as If-Match and returns the new one', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 200, body: '{"@odata.etag":"W/\\"new\\""}' } as any);

    const tag = await pushProcess(makeProcess(), CFG, 'W/"old"');

    expect(mockApi.mock.calls[0][5]).toEqual({ 'If-Match': 'W/"old"' });
    expect(tag).toBe('W/"new"');
  });

  it('throws on 5xx server error', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 500, body: 'oops' } as any);

    await expect(pushProcess(makeProcess(), CFG)).rejects.toThrow(/HTTP 500/);
  });

  it('encodes name in path', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);

    await pushProcess(makeProcess({ name: 'My Process' }), CFG);
    expect(mockApi.mock.calls[0][1]).toContain(`Processes('${encodeURIComponent('My Process')}')`);
  });
});

describe('processPusher — column lists and wizard state', () => {
  const okThenCapture = () => {
    mockApi.mockResolvedValueOnce({ statusCode: 204, body: '' } as any);
    return () => JSON.parse(String(mockApi.mock.calls[0][2]));
  };

  it('sends both lists together when the header carries VariablesUIData', async () => {
    const body = okThenCapture();
    await pushProcess(makeProcess({
      variables: [{ Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
      variablesUiData: ['VarType=32\fColType=827\f', 'IgnoredInputVarName=x\fVarType=32\fColType=1165\f'],
    }), CFG);
    expect(body().VariablesUIData).toHaveLength(2);
    expect(body().Variables).toHaveLength(1);
  });

  it('leaves VariablesUIData alone for a legacy header that has none', async () => {
    // An invented `[]` would delete the ignore marks on the server —
    // TM1 never reconciles the two lists with each other.
    const body = okThenCapture();
    await pushProcess(makeProcess({
      variables: [{ Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
    }), CFG);
    expect('VariablesUIData' in body()).toBe(false);
  });

  it('derives the pair from a legacy header whose variables carry Ignored', async () => {
    const body = okThenCapture();
    await pushProcess(makeProcess({
      variables: [
        { Name: 'v1', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 },
        { Name: 'vsSKIP', Type: 'String', Position: 2, StartByte: 0, EndByte: 0, Ignored: true },
      ],
    }), CFG);
    // The ignored column drops out of `Variables` and lives only in the UIData line.
    expect(body().Variables.map((v: any) => v.Name)).toEqual(['v1']);
    expect(body().VariablesUIData).toHaveLength(2);
    expect(body().VariablesUIData[1]).toContain('IgnoredInputVarName=vsSKIP');
    expect(body().Variables[0].Ignored).toBeUndefined();
  });

  it('sends UIData when known and omits it when not', async () => {
    const withUi = okThenCapture();
    await pushProcess(makeProcess({ uiData: 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f' }), CFG);
    expect(withUi().UIData).toBe('CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f');

    mockApi.mockReset();
    const without = okThenCapture();
    await pushProcess(makeProcess(), CFG);
    expect('UIData' in without()).toBe(false);
  });

  it('POST of a new process carries UIData — a POST does not create it otherwise', async () => {
    mockApi.mockResolvedValueOnce({ statusCode: 404, body: '' } as any)
           .mockResolvedValueOnce({ statusCode: 201, body: '{}' } as any);
    await pushProcess(makeProcess({ uiData: 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f' }), CFG);
    const body = JSON.parse(String(mockApi.mock.calls[1][2]));
    expect(body.Name).toBe('TestProc');
    expect(body.UIData).toBe('CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f');
  });
});

/**
 * `undefined` means "do not touch", `[]` means "remove all" — the same
 * contract as for `Variables`/`VariablesUIData`.
 *
 * Until 2026-08-31 the pusher had `p.parameters.length > 0`, with which a parameter list
 * emptied in the repo NEVER reached the server, while the push still reported
 * success. Measured on 2026-08-31 on 11.8 on a throwaway process: a PATCH
 * with `Parameters` REPLACES the list (2 -> 1), `Parameters: []` really empties
 * it, and without the field it stays untouched.
 */
describe('pushProcess — Parameterliste', () => {
  function patchBodyOf(): Record<string, unknown> {
    const patch = mockApi.mock.calls.find(c => c[0] === 'PATCH')!;
    return JSON.parse(patch[2] as string) as Record<string, unknown>;
  }

  it('sends an empty list, so clearing the parameters in git reaches the server', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{}' } as never);
    await pushProcess(makeProcess({ parameters: [] }), CFG);
    expect(patchBodyOf().Parameters).toEqual([]);
  });

  it('sends the list it was given', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{}' } as never);
    const params = [{ Name: 'pMonth', Prompt: 'Month', Value: '1', Type: 'String' }];
    await pushProcess(makeProcess({ parameters: params as never }), CFG);
    expect(patchBodyOf().Parameters).toEqual(params);
  });

  // A header file without a `Parameters` key says nothing about parameters. An
  // invented `[]` would delete the server list here.
  it('leaves the server list alone when the header says nothing', async () => {
    mockApi.mockResolvedValue({ statusCode: 200, body: '{}' } as never);
    await pushProcess(makeProcess({ parameters: undefined }), CFG);
    expect(patchBodyOf()).not.toHaveProperty('Parameters');
  });

  it('carries the empty list into the POST when the process is new', async () => {
    mockApi
      .mockResolvedValueOnce({ statusCode: 404, body: '' } as never)
      .mockResolvedValue({ statusCode: 201, body: '{}' } as never);
    await pushProcess(makeProcess({ parameters: [] }), CFG);
    const post = mockApi.mock.calls.find(c => c[0] === 'POST')!;
    expect((JSON.parse(post[2] as string) as Record<string, unknown>).Parameters).toEqual([]);
  });
});
