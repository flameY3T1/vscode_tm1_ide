import { describe, it, expect, vi } from 'vitest';
import { handleConsistencyMessage } from '../../tiConsistency/handleMessage';

const cfg = { serverUrl: 'http://x' } as any;
const procs = [{ name: 'A', units: [{ key: 'prolog', text: 'sDim=1;' }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] }];

function ctx(overrides = {}) {
  return { fetch: vi.fn().mockResolvedValue({ processes: procs, unreadable: [] }), ...overrides } as any;
}

describe('handleConsistencyMessage', () => {
  it('listProcesses returns filtered names', async () => {
    const out = await handleConsistencyMessage({ type: 'listProcesses', filter: { prefix: [], suffix: [], contains: [] } }, cfg, ctx());
    expect(out).toEqual({ type: 'processList', names: ['A'] });
  });
  it('scan returns groups for selected processes', async () => {
    const out: any = await handleConsistencyMessage(
      { type: 'scan', ruleKind: 'var-casing', selected: ['A'] }, cfg,
      ctx({ fetch: vi.fn().mockResolvedValue({ processes: [
        { name: 'A', units: [{ key: 'prolog', text: 'sDim=1;\nnX=SDIM;' }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] },
      ], unreadable: [] }) }));
    expect(out.type).toBe('groups');
    expect(out.groups.find((g: any) => g.key === 'sdim')).toBeTruthy();
  });
  it('open message returns a route directive', async () => {
    const out = await handleConsistencyMessage({ type: 'open', objectName: 'A', unit: 'prolog', line: 1 }, cfg, ctx());
    expect(out).toMatchObject({ route: 'open', objectName: 'A', unit: 'prolog', line: 1 });
  });
});
