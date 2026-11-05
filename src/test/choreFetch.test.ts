import { describe, it, expect } from 'vitest';
import { mapChoresResponse, invalidateReferenceIndex } from '../references/referenceIndexService';

describe('mapChoresResponse', () => {
  it('maps an OData response to ChoreFetchResult[]', () => {
    const body = {
      value: [
        {
          Name: 'DailyLoad',
          Tasks: [
            {
              Step: 0,
              Process: { Name: 'p.load.header' },
              Parameters: [
                { Name: 'pDate', Value: '2026-01-01', Type: 'String' },
                { Name: 'pRun',  Value: 1,            Type: 'Numeric' },
              ],
            },
            {
              Step: 1,
              Process: { Name: 'p.load.detail' },
              Parameters: [],
            },
          ],
        },
      ],
    };
    const result = mapChoresResponse(body);
    expect(result).toEqual([
      {
        name: 'DailyLoad',
        tasks: [
          {
            step: 0,
            processName: 'p.load.header',
            params: [
              { name: 'pDate', value: '2026-01-01', type: 'string' },
              { name: 'pRun',  value: '1',           type: 'numeric' },
            ],
          },
          { step: 1, processName: 'p.load.detail', params: [] },
        ],
      },
    ]);
  });

  it('returns [] for malformed bodies', () => {
    expect(mapChoresResponse({})).toEqual([]);
    expect(mapChoresResponse({ value: null })).toEqual([]);
    expect(mapChoresResponse(null)).toEqual([]);
    expect(mapChoresResponse(undefined)).toEqual([]);
  });

  it('skips entries without Name or without Process.Name', () => {
    const body = {
      value: [
        { Tasks: [{ Step: 0, Process: { Name: 'x' } }] }, // no chore Name → skip
        {
          Name: 'C',
          Tasks: [
            { Step: 0, Process: { Name: '' } },          // empty process name → skip task
            { Step: 1, Process: { Name: 'realProc' } },
          ],
        },
      ],
    };
    const result = mapChoresResponse(body);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('C');
    expect(result[0].tasks).toHaveLength(1);
    expect(result[0].tasks[0].processName).toBe('realProc');
  });

  it('falls back to index when Step is missing', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [
          { Process: { Name: 'a' } },
          { Process: { Name: 'b' } },
        ],
      }],
    };
    const result = mapChoresResponse(body);
    expect(result[0].tasks.map(t => t.step)).toEqual([0, 1]);
  });

  it('filters out parameters without Name (server quirk: empty Name slots)', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [{
          Step: 0,
          Process: { Name: 'p' },
          Parameters: [
            { Name: 'pKept', Value: 'v', Type: 'String' },
            { Value: 'orphan', Type: 'String' },        // no Name → skip
            { Name: '',       Value: 'empty', Type: 'String' }, // falsy Name → skip
          ],
        }],
      }],
    };
    const params = mapChoresResponse(body)[0].tasks[0].params;
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('pKept');
  });

  it('coerces numeric Value to string and missing/null Value to empty string', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [{
          Step: 0,
          Process: { Name: 'p' },
          Parameters: [
            { Name: 'pNum',  Value: 42,        Type: 'Numeric' },
            { Name: 'pMiss',                  Type: 'String'  }, // undefined Value
            { Name: 'pNull', Value: null,     Type: 'String'  },
            { Name: 'pZero', Value: 0,        Type: 'Numeric' }, // falsy but defined → '0'
          ],
        }],
      }],
    };
    const params = mapChoresResponse(body)[0].tasks[0].params;
    expect(params.map(p => p.value)).toEqual(['42', '', '', '0']);
  });

  it('normalises Type case-insensitively (Numeric variants → "numeric")', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [{
          Step: 0,
          Process: { Name: 'p' },
          Parameters: [
            { Name: 'a', Value: '', Type: 'Numeric' },
            { Name: 'b', Value: '', Type: 'numeric' },
            { Name: 'c', Value: '', Type: 'NUMERIC' },
            { Name: 'd', Value: '', Type: 'NuMeRiC' },
          ],
        }],
      }],
    };
    const params = mapChoresResponse(body)[0].tasks[0].params;
    expect(params.map(p => p.type)).toEqual(['numeric', 'numeric', 'numeric', 'numeric']);
  });

  it('defaults Type to "string" when missing or unrecognised', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [{
          Step: 0,
          Process: { Name: 'p' },
          Parameters: [
            { Name: 'a', Value: '' },                  // no Type
            { Name: 'b', Value: '', Type: 'String' },
            { Name: 'c', Value: '', Type: 'Bogus' },   // unrecognised
          ],
        }],
      }],
    };
    const params = mapChoresResponse(body)[0].tasks[0].params;
    expect(params.map(p => p.type)).toEqual(['string', 'string', 'string']);
  });

  it('handles tasks with missing Process gracefully (skips them)', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [
          { Step: 0 },                              // no Process at all
          { Step: 1, Process: {} },                 // Process without Name
          { Step: 2, Process: { Name: 'real' } },
        ],
      }],
    };
    const tasks = mapChoresResponse(body)[0].tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ step: 2, processName: 'real' });
  });

  it('handles missing Parameters array (no map crash)', () => {
    const body = {
      value: [{
        Name: 'C',
        Tasks: [{ Step: 0, Process: { Name: 'p' } }],   // no Parameters key
      }],
    };
    expect(mapChoresResponse(body)[0].tasks[0].params).toEqual([]);
  });
});

describe('invalidateReferenceIndex', () => {
  it('is callable with undefined (full-clear path)', () => {
    expect(() => invalidateReferenceIndex(undefined)).not.toThrow();
  });

  it('is callable with a config (per-server clear path)', () => {
    const cfg = { serverUrl: 'http://example:1234' } as Parameters<typeof invalidateReferenceIndex>[0];
    expect(() => invalidateReferenceIndex(cfg)).not.toThrow();
  });
});
