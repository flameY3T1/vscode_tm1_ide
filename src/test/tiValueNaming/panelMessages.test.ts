import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleValueNamingMessage } from '../../tiValueNaming/handleMessage';
import { applyConsistencyEdits } from '../../tiConsistency/apply';

vi.mock('../../tiConsistency/apply', () => ({
  applyConsistencyEdits: vi.fn(),
}));

const mockedApply = vi.mocked(applyConsistencyEdits);

const cfg = { serverUrl: 'http://x' } as any;
const procs = [
  { name: 'A', units: [{ key: 'prolog', text: "sAllElementsA = 'v';" }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] },
  { name: 'B', units: [{ key: 'prolog', text: "sConsolidatedA = 'v';" }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] },
];
const ctx = () => ({ fetch: vi.fn().mockResolvedValue({ processes: procs, unreadable: [] }) } as any);

beforeEach(() => {
  mockedApply.mockReset();
  mockedApply.mockResolvedValue({ applied: [], notAttempted: [], skipped: [] });
});

describe('handleValueNamingMessage', () => {
  it('listProcesses returns filtered names', async () => {
    const out = await handleValueNamingMessage({ type: 'listProcesses', filter: { prefix: [], suffix: [], contains: [] } }, cfg, ctx());
    expect(out).toEqual({ type: 'processList', names: ['A', 'B'] });
  });
  it('scan returns value groups for selected processes', async () => {
    const out: any = await handleValueNamingMessage({ type: 'scan', selected: ['A', 'B'] }, cfg, ctx());
    expect(out.type).toBe('groups');
    expect(out.groups.find((g: any) => g.valueKey === 'v')).toBeTruthy();
  });
  it('open returns a route directive', async () => {
    const out = await handleValueNamingMessage({ type: 'open', objectName: 'A', unit: 'prolog', line: 1 }, cfg, ctx());
    expect(out).toMatchObject({ route: 'open', objectName: 'A', unit: 'prolog', line: 1 });
  });

  it('preview plans a rename for the non-canonical process only (real planNameUnify)', async () => {
    const out = await handleValueNamingMessage(
      { type: 'preview', valueKey: 'v', canonical: 'sAllElementsA', selected: ['A', 'B'] },
      cfg,
      ctx(),
    );
    expect(out).toEqual({
      type: 'previewResult',
      valueKey: 'v',
      plan: { edits: [{ process: 'B' }], skipped: [] },
    });
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('applyGroup applies the planned edit via applyConsistencyEdits and returns its report', async () => {
    mockedApply.mockResolvedValueOnce({ applied: ['B'], notAttempted: [], skipped: [] });

    const out = await handleValueNamingMessage(
      { type: 'applyGroup', valueKey: 'v', canonical: 'sAllElementsA', selected: ['A', 'B'] },
      cfg,
      ctx(),
    );

    expect(out).toEqual({ type: 'report', report: { applied: ['B'], notAttempted: [], skipped: [] } });
    expect(mockedApply).toHaveBeenCalledTimes(1);
    const [calledCfg, calledEdits] = mockedApply.mock.calls[0];
    expect(calledCfg).toBe(cfg);
    expect(calledEdits).toEqual([expect.objectContaining({ process: 'B' })]);
  });

  it('applyAll aggregates applied/skipped across targets and stops on first failure', async () => {
    mockedApply
      .mockResolvedValueOnce({ applied: ['B'], notAttempted: [], skipped: [] })
      .mockResolvedValueOnce({ applied: [], failed: { process: 'C', error: 'boom' }, notAttempted: ['C'], skipped: [] });

    const out: any = await handleValueNamingMessage(
      {
        type: 'applyAll',
        selected: ['A', 'B'],
        targets: [
          { valueKey: 'v1', canonical: 'n1' },
          { valueKey: 'v2', canonical: 'n2' },
        ],
      },
      cfg,
      ctx(),
    );

    expect(out.type).toBe('report');
    expect(out.report.applied).toEqual(['B']);
    expect(out.report.failed).toEqual({ process: 'C', error: 'boom' });
    expect(out.report.notAttempted).toEqual(['C']);
    // stops-on-failure: exactly two targets, exactly two applyConsistencyEdits calls — no retry/continue past the break.
    expect(mockedApply).toHaveBeenCalledTimes(2);
  });

  const multiValueProcs = [
    { name: 'P', units: [{ key: 'prolog', text: "f = 'a';\nu(f);\nf = 'b';\nu(f);" }], params: [], datasourceVars: [], rawParams: [], rawVariables: [] },
  ];
  const multiValueCtx = () => ({ fetch: vi.fn().mockResolvedValue({ processes: multiValueProcs, unreadable: [] }) } as any);

  it('scan returns multi-value vars alongside groups', async () => {
    const out: any = await handleValueNamingMessage({ type: 'scan', selected: ['P'] }, cfg, multiValueCtx());
    expect(out.type).toBe('groups');
    expect(out.multiValue[0].varName).toBe('f');
  });

  it('previewSplit reports a range-scoped plan', async () => {
    const out: any = await handleValueNamingMessage(
      { type: 'previewSplit', process: 'P', varLc: 'f', defId: 1, newName: 'g' },
      cfg,
      multiValueCtx(),
    );
    expect(out.type).toBe('splitPreview');
    expect(out.plan.skipped).toEqual([]);
  });

  it('scan drops a value group whose names collapse to < 2 after exclusion', async () => {
    // procs A/B share value 'v' under sAllElementsA / sConsolidatedA (2 names → a group).
    // Excluding sConsolidatedA leaves 1 name → group dropped.
    const out: any = await handleValueNamingMessage(
      { type: 'scan', selected: ['A', 'B'] },
      cfg,
      { ...ctx(), excludes: ['sConsolidatedA'] },
    );
    expect(out.type).toBe('groups');
    expect(out.groups.find((g: any) => g.valueKey === 'v')).toBeUndefined();
  });

  it('scan drops multi-value vars matching an exclude glob', async () => {
    const out: any = await handleValueNamingMessage(
      { type: 'scan', selected: ['P'] },
      cfg,
      { ...multiValueCtx(), excludes: ['f'] },
    );
    expect(out.type).toBe('groups');
    expect(out.multiValue).toEqual([]);
  });
});
