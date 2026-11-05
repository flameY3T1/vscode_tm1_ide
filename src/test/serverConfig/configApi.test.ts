import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { fetchAll, save, flatten, unflatten, collectPaths } from '../../serverConfig/configApi';

const cfg = { serverUrl:'http://x', username:'u', password:'p', rejectUnauthorized:true } as any;

beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

describe('fetchAll', () => {
  it('calls 3 endpoints in parallel and merges values', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ HTTPPortNumber: 5000, MTQ: 'ALL', ProductVersion: '11.8' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ HTTPPortNumber: 5000, ProductVersion: '11.8' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MTQ: 'ALL' }) });

    const result = await fetchAll(cfg);

    expect(vi.mocked(apiRequest).mock.calls.map(c => c[1])).toEqual([
      'Configuration', 'StaticConfiguration', 'ActiveConfiguration',
    ]);
    expect(result.values.get('MTQ')).toBe('ALL');
    expect(result.values.get('HTTPPortNumber')).toBe(5000);
    expect(result.staticKeys.has('HTTPPortNumber')).toBe(true);
    expect(result.activeKeys.has('MTQ')).toBe(true);
  });

  it('falls back gracefully when StaticConfiguration is 404 (old TM1)', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MTQ: 'ALL' }) })
      .mockResolvedValueOnce({ statusCode: 404, body: '' })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MTQ: 'ALL' }) });

    const result = await fetchAll(cfg);
    expect(result.staticKeys.size).toBe(0);
    expect(result.values.get('MTQ')).toBe('ALL');
  });

  it('throws on /Configuration HTTP 403', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 403, body: 'forbidden' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    await expect(fetchAll(cfg)).rejects.toThrow(/403/);
  });

  it('throws decorated SyntaxError when /Configuration returns non-JSON body', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: '<html>proxy error</html>' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    await expect(fetchAll(cfg)).rejects.toThrow(/Configuration: invalid JSON/);
  });

  it('strips @odata.context from values', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ '@odata.context': 'http://x/$metadata#Configuration', MTQ: 'ALL' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' })
      .mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    const result = await fetchAll(cfg);
    expect(result.values.has('@odata.context')).toBe(false);
    expect(result.values.get('MTQ')).toBe('ALL');
  });
});

describe('save', () => {
  // TM1 11.x rejects PATCH on /ActiveConfiguration with HTTP 400 code 278
  // ("PATCH not allowed on this resource"). All edits go to /StaticConfiguration
  // in a single nested PATCH, mirroring tm1py's ConfigurationService.update_static.
  it('merges all edits into a single StaticConfiguration PATCH', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });

    const edits = new Map<string, unknown>([
      ['SecurityPackageName', 'Kerberos'],
      ['HTTPPortNumber', 5001],
    ]);

    const result = await save(cfg, edits);

    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('PATCH');
    expect(calls[0][1]).toBe('StaticConfiguration');
    expect(calls[0][5]).toBeUndefined();
    // HTTPPortNumber carries a live-verified override path even without snapshot hints;
    // SecurityPackageName has none and stays flat (legacy best-effort when the server told us nothing).
    expect(JSON.parse(calls[0][2] as string)).toEqual({ SecurityPackageName: 'Kerberos', Access: { HTTP: { Port: 5001 } } });
    expect(result.errors).toEqual([]);
    // Both are static in the schema, so both appear in the restart list.
    expect(result.restartNeeded).toEqual(['SecurityPackageName', 'HTTPPortNumber']);
  });

  it('skips PATCH when nothing remains after validation', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const edits = new Map<string, unknown>([['ProductVersion', '99.99']]);  // readonly
    await save(cfg, edits);
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(0);
  });

  it('reports static target on PATCH HTTP error', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ statusCode: 400, body: 'rejected' });
    const edits = new Map<string, unknown>([['SecurityPackageName', 'Kerberos']]);
    const result = await save(cfg, edits);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].target).toBe('static');
    expect(result.errors[0].statusCode).toBe(400);
  });

  it('captures coerceType validation errors and continues with other params', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const edits = new Map<string, unknown>([
      ['HTTPPortNumber', 'not-a-number'],   // schema=number → coerceType throws
      ['SecurityPackageName', 'Kerberos'],                       // schema=string → ok
    ]);
    const result = await save(cfg, edits);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].target).toBe('validation');
    expect(result.errors[0].param).toBe('HTTPPortNumber');
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(1);
    expect(vi.mocked(apiRequest).mock.calls[0][1]).toBe('StaticConfiguration');
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string)).toEqual({ SecurityPackageName: 'Kerberos' });
  });

  it('skips readonly params with a validation error', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const edits = new Map<string, unknown>([
      ['ProductVersion', '99.99'],   // readonly in schema
      ['SecurityPackageName', 'Kerberos'],
    ]);
    const result = await save(cfg, edits);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].target).toBe('validation');
    expect(result.errors[0].param).toBe('ProductVersion');
    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe('StaticConfiguration');
    const body = JSON.parse(calls[0][2] as string);
    expect(body).toEqual({ SecurityPackageName: 'Kerberos' });
    expect('ProductVersion' in body).toBe(false);
  });
});

describe('flatten', () => {
  it('passes through flat objects unchanged', () => {
    expect(flatten({ A: 1, B: 'x' })).toEqual({ A: 1, B: 'x' });
  });
  it('recursively flattens nested objects with dot separator', () => {
    expect(flatten({ Modelling: { EnableNewHierarchyCreation: true, Rules: { AllowSeparate: false } } }))
      .toEqual({ 'Modelling.EnableNewHierarchyCreation': true, 'Modelling.Rules.AllowSeparate': false });
  });
  it('drops null leaves and @odata.context', () => {
    expect(flatten({ '@odata.context': 'x', A: null, B: 1 })).toEqual({ B: 1 });
  });
  it('keeps arrays as leaf values (not flattened)', () => {
    expect(flatten({ ClientCAMURIs: ['a', 'b'] })).toEqual({ ClientCAMURIs: ['a', 'b'] });
  });
});

describe('unflatten', () => {
  it('inverts flatten for simple cases', () => {
    const m = new Map<string, unknown>([['Modelling.EnableNewHierarchyCreation', true]]);
    expect(unflatten(m)).toEqual({ Modelling: { EnableNewHierarchyCreation: true } });
  });
  it('groups multiple leaves under same prefix', () => {
    const m: Array<[string, unknown]> = [
      ['Modelling.A', 1],
      ['Modelling.B', 2],
      ['Performance.MTQ.UseAllThreads', true],
    ];
    expect(unflatten(m)).toEqual({
      Modelling: { A: 1, B: 2 },
      Performance: { MTQ: { UseAllThreads: true } },
    });
  });
  it('handles flat (no-dot) keys at root', () => {
    expect(unflatten([['SecurityPackageName', 'Kerberos']])).toEqual({ SecurityPackageName: 'Kerberos' });
  });
});

describe('fetchAll with nested PA-style endpoints', () => {
  it('flattens nested StaticConfiguration response into dotted leaves', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ JobQueuing: true, ProductVersion: '11.8' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({
        Modelling: { EnableNewHierarchyCreation: true },
        Performance: { JobQueuing: { Enable: true } },
        Administration: { ServerName: 'X' },
      }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({}) });

    const result = await fetchAll(cfg);
    expect(result.values.get('Modelling.EnableNewHierarchyCreation')).toBe(true);
    expect(result.values.get('Performance.JobQueuing.Enable')).toBe(true);
    expect(result.staticKeys.has('Modelling.EnableNewHierarchyCreation')).toBe(true);
    expect(result.values.has('Modelling')).toBe(false);   // raw container key not exposed
    expect(result.values.get('JobQueuing')).toBe(true);   // legacy /Configuration key still merged
  });
});

describe('collectPaths', () => {
  it('keeps null leaves that flatten() drops', () => {
    expect(collectPaths({ Administration: { PerfMonActive: null, ServerName: 'X' } }))
      .toEqual(['Administration.PerfMonActive', 'Administration.ServerName']);
  });
  it('skips @odata annotations and treats arrays as leaves', () => {
    expect(collectPaths({ '@odata.context': 'x', ClientCAMURIs: ['a', 'b'] })).toEqual(['ClientCAMURIs']);
  });
});

describe('fetchAll path knowledge', () => {
  // Live 11.8: /StaticConfiguration has 158 leaves, 129 of them null. flatten() drops
  // nulls, so staticKeys knew only 29 paths — every not-yet-configured param lost its
  // nesting and PATCHed to the root. paths keeps the shape independent of the values.
  it('exposes nested paths for unset (null) static params', async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MTQ: 'ALL' }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Administration: { PerfMonActive: null } }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ Administration: { PerfMonActive: true } }) });

    const result = await fetchAll(cfg);
    expect(result.staticKeys.has('Administration.PerfMonActive')).toBe(false);
    expect(result.paths.has('Administration.PerfMonActive')).toBe(true);
  });
});

describe('save path resolution', () => {
  it('nests a flat schema name onto the path known from the snapshot', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await save(cfg, new Map([['PerfMonActive', true]]), {
      paths: new Set(['Administration.PerfMonActive']),
    });
    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls.length).toBe(1);
    expect(JSON.parse(calls[0][2] as string)).toEqual({ Administration: { PerfMonActive: true } });
    expect(result.errors).toEqual([]);
  });

  it('prefers an exact root-level path over a nested namesake', async () => {
    // Live 11.8: ServerName exists both at the root and under Administration; PATCHing
    // the root form returns 200, so an exact hit must win over the suffix scan.
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await save(cfg, new Map([['ServerName', 'SALES']]), {
      paths: new Set(['ServerName', 'Administration.ServerName']),
    });
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string)).toEqual({ ServerName: 'SALES' });
  });

  it('falls back to the override map when the tm1.cfg name differs from the REST leaf', async () => {
    // MaximumViewSize (tm1.cfg) is Performance.Memory.MaximumViewSizeMB in REST — no suffix hit.
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    await save(cfg, new Map([['MaximumViewSize', 5000]]), {
      paths: new Set(['Performance.Memory.MaximumViewSizeMB']),
    });
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Performance: { Memory: { MaximumViewSizeMB: 5000 } } });
  });

  it('rejects a param with no known path instead of PATCHing it to the root', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await save(cfg, new Map([['SecurityPackageName', 'Kerberos']]), {
      paths: new Set(['Administration.PerfMonActive']),
    });
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].target).toBe('validation');
    expect(result.errors[0].param).toBe('SecurityPackageName');
  });

  // The whole way from the form down to the wire: the form carries the row
  // under the NESTED name and delivers '2' as a string, while the body
  // must contain a NUMBER. As a string, 11.8 returns
  // `400 code 278 Invalid enum value encountered in payload.`
  it('writes IntegratedSecurityMode as a JSON number, not a string', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: '{}' });
    const result = await save(cfg, new Map([['Access.Authentication.IntegratedSecurityMode', '2']]), {
      paths: new Set(['Access.Authentication.IntegratedSecurityMode']),
      values: new Map<string, unknown>([['Access.Authentication.IntegratedSecurityMode', 'Basic']]),
    });
    expect(result.errors).toEqual([]);
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Access: { Authentication: { IntegratedSecurityMode: 2 } } });
  });

  it('still attempts a flat PATCH when the server exposed no paths at all', async () => {
    // /StaticConfiguration 404 on old TM1 → no path knowledge → keep the legacy attempt.
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const result = await save(cfg, new Map([['SecurityPackageName', 'Kerberos']]), { paths: new Set() });
    expect(vi.mocked(apiRequest).mock.calls.length).toBe(1);
    expect(result.errors).toEqual([]);
  });
});

describe('save with nested keys', () => {
  it('un-flattens dotted keys into a single nested StaticConfiguration PATCH', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' });
    const edits = new Map<string, unknown>([
      ['Modelling.EnableNewHierarchyCreation', false],
      ['Performance.MTQ.UseAllThreads', true],
    ]);
    const result = await save(cfg, edits);

    const calls = vi.mocked(apiRequest).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe('StaticConfiguration');
    expect(JSON.parse(calls[0][2] as string)).toEqual({
      Modelling: { EnableNewHierarchyCreation: false },
      Performance: { MTQ: { UseAllThreads: true } },
    });
    expect(result.errors).toEqual([]);
    // Schema-unknown nested keys are conservatively flagged for restart.
    expect(result.restartNeeded).toContain('Modelling.EnableNewHierarchyCreation');
    expect(result.restartNeeded).toContain('Performance.MTQ.UseAllThreads');
  });
});

/**
 * MTQ carries ONE cfg value across TWO leaves. Measured on 11.8 on 2026-08-31:
 * `{UseAllThreads:false, NumberOfThreadsToUse:-4}` answers with HTTP 200 and
 * reads back as -4; `{UseAllThreads:true}` alone sets the number to
 * null, whereas an explicitly sent `null` deletes BOTH fields.
 */
describe('save — names with value conversion', () => {
  const cfg = { serverUrl: 'https://x', username: 'u', password: 'p' } as never;

  it('writes MTQ to both leaves in one PATCH', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' } as never);
    const res = await save(cfg, new Map([['MTQ', '-4']]), { paths: new Set(['Performance.MTQ.UseAllThreads', 'Performance.MTQ.NumberOfThreadsToUse']) });
    expect(res.errors).toEqual([]);
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Performance: { MTQ: { UseAllThreads: false, NumberOfThreadsToUse: -4 } } });
  });

  it('sends only the flag for ALL, never an empty thread count', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' } as never);
    await save(cfg, new Map([['MTQ', 'ALL']]), { paths: new Set(['Performance.MTQ.UseAllThreads']) });
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Performance: { MTQ: { UseAllThreads: true } } });
  });

  it('turns minutes back into the duration TM1 expects', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' } as never);
    await save(cfg, new Map([['HTTPSessionTimeoutMinutes', '30']]), { paths: new Set(['Access.HTTP.SessionTimeout']) });
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Access: { HTTP: { SessionTimeout: 'P0DT00H30M00S' } } });
  });

  // The generic way: recognised by the most recently READ value of the leaf, not by
  // a list of names. The form shows seconds there.
  it('turns seconds back into a duration for any leaf that carries one', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' } as never);
    await save(cfg, new Map([['Administration.TopLog.ScanFrequency', '5']]), {
      paths: new Set(['Administration.TopLog.ScanFrequency']),
      values: new Map([['Administration.TopLog.ScanFrequency', 'P0DT00H00M01S']]),
    });
    expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string))
      .toEqual({ Administration: { TopLog: { ScanFrequency: 'P0DT00H00M05S' } } });
  });

  it('refuses an MTQ value TM1 could not represent', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 204, body: '' } as never);
    const res = await save(cfg, new Map([['MTQ', 'AUTO']]), { paths: new Set(['Performance.MTQ.UseAllThreads']) });
    expect(res.errors[0].param).toBe('MTQ');
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalled();
  });
});
