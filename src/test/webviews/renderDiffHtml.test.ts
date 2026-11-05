import { describe, it, expect } from 'vitest';
import { renderDiffHtml, type DiffViewInput } from '../../webviews/renderDiffHtml';
import type { Manifest } from '../../tiTestFramework/storage/manifestIo';
import { capDiffResult, summarize, type DiffResult } from '../../tiTestFramework/diff/diffResult';

const baseManifest: Manifest = {
  schemaVersion: 1,
  name: 'copyActuals_jan',
  process: 'CopyActuals',
  active: true,
  captured: { at: '2026-05-09T10:30:00Z', server: 'prod', extensionVersion: '1.23.0' },
  datasourceType: 'None',
  writeTargets: { cubes: ['Plan'], dimensions: [] },
};

const emptyOpDiff = () => ({ equal: [], valueDiff: [], missing: [], extra: [] });

const passingDiff = (): DiffResult => ({
  cell: { equal: [], valueDiff: [], missing: [], extra: [] },
  dim: emptyOpDiff(),
  attr: emptyOpDiff(),
  subset: emptyOpDiff(),
  view: emptyOpDiff(),
  cube: emptyOpDiff(),
  tran: emptyOpDiff(),
  meta: emptyOpDiff(),
  status: {
    equal: true,
    statusMatch: true,
    errorLogMatch: true,
    expected: { status: 'success', errorLogContent: '' },
    actual: { status: 'success', errorLogContent: '' },
  },
});

const baseInput = (overrides: Partial<DiffViewInput> = {}): DiffViewInput => ({
  manifest: baseManifest,
  diff: passingDiff(),
  summary: {
    pass: true,
    totalDiffs: 0,
    cellDiffs: 0,
    dimDiffs: 0,
    attrDiffs: 0,
    subsetDiffs: 0,
    viewDiffs: 0,
    cubeDiffs: 0,
    tranDiffs: 0,
    metaDiffs: 0,
    statusDiff: false,
  },
  ...overrides,
});

describe('renderDiffHtml', () => {
  it('renders PASS pill when summary.pass is true', () => {
    const html = renderDiffHtml(baseInput());
    expect(html).toContain('class="pill pass"');
    expect(html).toContain('>PASS<');
  });

  it('renders FAIL pill when summary.pass is false', () => {
    const html = renderDiffHtml(
      baseInput({ summary: { ...baseInput().summary, pass: false, totalDiffs: 1, cellDiffs: 1 } }),
    );
    expect(html).toContain('class="pill fail"');
    expect(html).toContain('>FAIL<');
  });

  it('includes manifest metadata (process, captured-at, server)', () => {
    const html = renderDiffHtml(baseInput());
    expect(html).toContain('CopyActuals');
    expect(html).toContain('2026-05-09T10:30:00Z');
    expect(html).toContain('prod');
  });

  it('renders cell valueDiff rows in a per-cube table with the coord as separate cells', () => {
    const diff = passingDiff();
    diff.cell.valueDiff.push({ cube: 'Plan', coord: ['Jan'], expected: 100, actual: 200 });
    const html = renderDiffHtml(
      baseInput({
        diff,
        summary: { ...baseInput().summary, pass: false, totalDiffs: 1, cellDiffs: 1 },
      }),
    );
    expect(html).toContain('>Plan <');
    expect(html).toContain('row-valueDiff');
    expect(html).toContain('>Jan<');
    expect(html).toContain('>100<');
    expect(html).toContain('>200<');
  });

  it('uses cubeDims as column headers when provided', () => {
    const diff = passingDiff();
    diff.cell.valueDiff.push({ cube: 'Plan', coord: ['Jan', 'Sales'], expected: 1, actual: 2 });
    const html = renderDiffHtml(
      baseInput({
        diff,
        cubeDims: { Plan: ['Period', 'Measure'] },
        summary: { ...baseInput().summary, pass: false, totalDiffs: 1, cellDiffs: 1 },
      }),
    );
    expect(html).toContain('>Period</th>');
    expect(html).toContain('>Measure</th>');
  });

  it('falls back to Dim N headers when cubeDims missing', () => {
    const diff = passingDiff();
    diff.cell.valueDiff.push({ cube: 'Plan', coord: ['Jan', 'Sales'], expected: 1, actual: 2 });
    const html = renderDiffHtml(
      baseInput({
        diff,
        summary: { ...baseInput().summary, pass: false, totalDiffs: 1, cellDiffs: 1 },
      }),
    );
    expect(html).toContain('>Dim 1</th>');
    expect(html).toContain('>Dim 2</th>');
  });

  it('renders one table per cube when output spans multiple cubes', () => {
    const diff = passingDiff();
    diff.cell.valueDiff.push({ cube: 'Plan', coord: ['A'], expected: 1, actual: 2 });
    diff.cell.valueDiff.push({ cube: 'Forecast', coord: ['B'], expected: 3, actual: 4 });
    const html = renderDiffHtml(
      baseInput({
        diff,
        summary: { ...baseInput().summary, pass: false, totalDiffs: 2, cellDiffs: 2 },
      }),
    );
    expect(html).toContain('>Plan <');
    expect(html).toContain('>Forecast <');
  });

  it('renders missing as ∅ in actual column', () => {
    const diff = passingDiff();
    diff.cell.missing.push({ cube: 'Plan', coord: ['Feb'], expected: 50, actual: undefined });
    const html = renderDiffHtml(baseInput({ diff }));
    expect(html).toContain('row-missing');
    expect(html).toContain('∅');
  });

  it('renders extra as ∅ in expected column', () => {
    const diff = passingDiff();
    diff.cell.extra.push({ cube: 'Plan', coord: ['EU'], expected: undefined, actual: 50 });
    const html = renderDiffHtml(baseInput({ diff }));
    expect(html).toContain('row-extra');
    expect(html).toContain('∅');
  });

  it('omits empty op-list sections', () => {
    const html = renderDiffHtml(baseInput());
    expect(html).not.toContain('Dimensions <span class="badge"');
    expect(html).not.toContain('Attributes <span class="badge"');
  });

  it('renders Dimensions section when dim ops exist', () => {
    const diff = passingDiff();
    diff.dim.valueDiff.push({
      key: 'DimElementInsert|Region|||X',
      expected: {
        op: 'DimElementInsert',
        dim: 'Region',
        hier: '',
        name: 'X',
        type: 'N',
        insertAfter: '',
      },
      actual: undefined,
    });
    const html = renderDiffHtml(baseInput({ diff }));
    expect(html).toContain('Dimensions <span class="badge">');
    expect(html).toContain('DimElementInsert');
    expect(html).toContain('dim=Region');
    expect(html).toContain('name=X');
  });

  it('renders status mismatch table when statuses differ', () => {
    const diff = passingDiff();
    diff.status = {
      equal: false,
      statusMatch: false,
      errorLogMatch: true,
      expected: { status: 'success', errorLogContent: '' },
      actual: { status: 'minorErrors', errorLogContent: '' },
    };
    const html = renderDiffHtml(
      baseInput({
        diff,
        summary: { ...baseInput().summary, pass: false, statusDiff: true, totalDiffs: 1 },
      }),
    );
    expect(html).toContain('Status <span class="badge fail">');
    expect(html).toContain('minorErrors');
  });

  it('escapes HTML in user-controlled fields', () => {
    const evil: Manifest = {
      ...baseManifest,
      name: `<script>alert('xss')</script>`,
      process: `<img src=x onerror=alert(1)>`,
    };
    const html = renderDiffHtml(baseInput({ manifest: evil }));
    expect(html).not.toContain(`<script>alert('xss')</script>`);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('embeds CSP meta + script nonce when provided', () => {
    const html = renderDiffHtml(baseInput({ cspNonce: 'abc123', scriptUri: 'tiTestDiff.js' }));
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(`nonce-abc123`);
    expect(html).toContain(`<script nonce="abc123" src="tiTestDiff.js"></script>`);
  });

  it('always emits a CSP meta; locks scripts to none when no nonce provided', () => {
    const html = renderDiffHtml(baseInput());
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'none'");
  });

  it('contains filter buttons (All / Diffs only)', () => {
    const html = renderDiffHtml(baseInput());
    expect(html).toContain('data-filter="all"');
    expect(html).toContain('data-filter="diffs"');
  });

  it('shows total-diff counts in header meta (incl. tran + meta)', () => {
    const html = renderDiffHtml(
      baseInput({
        summary: {
          pass: false,
          totalDiffs: 7,
          cellDiffs: 3,
          dimDiffs: 1,
          attrDiffs: 1,
          subsetDiffs: 0,
          viewDiffs: 0,
          cubeDiffs: 0,
          tranDiffs: 1,
          metaDiffs: 1,
          statusDiff: false,
        },
      }),
    );
    expect(html).toMatch(/7 total diffs/);
    expect(html).toMatch(/cell 3/);
    expect(html).toMatch(/dim 1/);
    expect(html).toMatch(/tran 1/);
    expect(html).toMatch(/meta 1/);
  });

  it('renders Transactions section when tranOps differ', () => {
    const r = baseInput();
    r.diff.tran.missing.push({
      key: 'TranSave|tx-123',
      expected: { op: 'TranSave', transactionId: 'tx-123' },
      actual: undefined,
    });
    const html = renderDiffHtml(r);
    expect(html).toContain('Transactions');
    expect(html).toContain('transactionId=tx-123');
  });

  it('renders Meta section when metaOps differ', () => {
    const r = baseInput();
    r.diff.meta.extra.push({
      key: 'CustomFutureOp|x|y',
      expected: undefined,
      actual: { op: 'CustomFutureOp', args: ['x', 'y'] },
    });
    const html = renderDiffHtml(r);
    expect(html).toContain('Meta');
    expect(html).toContain('CustomFutureOp');
    expect(html).toContain('args=x,y');
  });
});

describe('renderDiffHtml — capped diff (tm1.tests.maxDiffRows)', () => {
  // A 1.8M-row production test pushed the page past V8's maximum string
  // length (RangeError, blank panel), and the cached diff held 1.39 GB.
  it('keeps max rows per kind, counts exactly, and names the dropped rows', () => {
    const entry = (i: number) => ({ cube: 'Plan', coord: [`E${i}`], expected: i, actual: undefined });
    const missing = Array.from({ length: 2500 }, (_, i) => entry(i));
    const equal = Array.from({ length: 100 }, (_, i) => ({ ...entry(i), actual: i }));
    const diff = capDiffResult({ ...passingDiff(), cell: { equal, valueDiff: [], missing, extra: [] } }, 2000);
    expect(diff.cell.missing).toHaveLength(2000);
    expect(diff.cell.equal).toHaveLength(100);
    expect(summarize(diff)).toMatchObject({ pass: false, cellDiffs: 2500, totalDiffs: 2500 });
    const html = renderDiffHtml(baseInput({ diff }));
    expect(html.match(/class="row-missing"/g)).toHaveLength(2000);
    expect(html).toContain('500 more rows not shown. Raise tm1.tests.maxDiffRows to keep more.');
  });

  it('a cap of 0 keeps nothing but still fails the test and says why', () => {
    const missing = [{ cube: 'Plan', coord: ['A'], expected: 1, actual: undefined }];
    const diff = capDiffResult({ ...passingDiff(), cell: { equal: [], valueDiff: [], missing, extra: [] } }, 0);
    expect(summarize(diff).pass).toBe(false);
    expect(renderDiffHtml(baseInput({ diff }))).toContain('1 more rows not shown.');
  });
});
