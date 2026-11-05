import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../tm1Client', () => ({ apiRequest: vi.fn(), assertOk: vi.fn() }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));
vi.mock('../../tm1Rest/sandboxTracker', () => ({ withSandbox: vi.fn(() => undefined) }));
import { apiRequest } from '../../tm1Client';
import { _fetchCellPage, ensureFullColTuples } from '../../commands/cubeViewer/cellset';

const CFG = { serverUrl: 'http://t:8001', username: 'a', password: 'p', authType: 'Basic' } as never;
beforeEach(() => vi.clearAllMocks());

describe('_fetchCellPage', () => {
  it('requests Cells with $skip=startRow*numCols & $top=rowCount*numCols, returns absolute keys', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Ordinal: 1000, Value: 7, FormattedValue: '7,00' }] }),
    });
    const out = await _fetchCellPage('CID', 100, 2, 10, CFG);
    const url = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain("Cellsets('CID')/Cells");
    expect(url).toContain('$skip=1000');          // 100 * 10
    expect(url).toContain('$top=20');             // 2 * 10
    expect(out.values['100,0']).toBe('7,00');      // ordinal 1000 / 10 = row 100, col 0
  });
});

describe('ensureFullColTuples', () => {
  it('returns tt unchanged (reference-equal) when col tuples are complete', async () => {
    const tt = { colTuples: [['C1']], colElements: ['C1'], extra: 1 };
    const out = await ensureFullColTuples(tt, 1, 'id', undefined as never);
    expect(out).toBe(tt); // reference-equal — no network call
    expect((apiRequest as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('refetches col axis and returns updated tt when numCols > colTuples.length', async () => {
    (apiRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ value: [{ Members: [{ Name: 'C1' }] }, { Members: [{ Name: 'C2' }] }] }),
    });
    const tt = { colTuples: [['C1']], colElements: ['C1'], titleAssignments: {} };
    const out = await ensureFullColTuples(tt, 2, 'CID', CFG);
    expect(out).not.toBe(tt);
    expect(out.colTuples).toHaveLength(2);
    expect(out.colTuples[1]).toEqual(['C2']);
    expect(out.colElements).toEqual(['C1', 'C2']);
    // other fields preserved
    expect(out.titleAssignments).toBe(tt.titleAssignments);
    const url = (apiRequest as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(url).toContain("Cellsets('CID')/Axes(0)/Tuples");
  });
});
