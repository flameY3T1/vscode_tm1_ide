import { describe, it, expect } from 'vitest';
import { renderSummaryHtml, type SummaryRow } from '../../webviews/renderSummaryHtml';

const passSummary = {
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
};

const failSummary = { ...passSummary, pass: false, totalDiffs: 3, cellDiffs: 3 };

const passRow: SummaryRow = {
  testFolder: '/tests/A/t1',
  testName: 't1',
  pass: true,
  summary: passSummary,
  durationMs: 120,
};

const failRow: SummaryRow = {
  testFolder: '/tests/A/t2',
  testName: 't2',
  pass: false,
  summary: failSummary,
  durationMs: 250,
};

const errorRow: SummaryRow = {
  testFolder: '/tests/A/t3',
  testName: 't3',
  pass: false,
  summary: passSummary,
  durationMs: 0,
  error: 'deploy HTTP 500',
};

describe('renderSummaryHtml', () => {
  it('renders the folder label as title', () => {
    const html = renderSummaryHtml({ folderLabel: 'Smoke', rows: [passRow] });
    expect(html).toContain('>Smoke<');
  });

  it('renders pass/fail/error counts in the header', () => {
    const html = renderSummaryHtml({ folderLabel: 'mixed', rows: [passRow, failRow, errorRow] });
    expect(html).toContain('3 tests');
    expect(html).toContain('1 pass');
    expect(html).toContain('1 fail');
    expect(html).toContain('1 error');
  });

  it('sums durationMs across rows', () => {
    const html = renderSummaryHtml({ folderLabel: 'mixed', rows: [passRow, failRow] });
    expect(html).toContain('total 370 ms');
  });

  it('renders PASS pill for passing rows', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [passRow] });
    expect(html).toContain('class="pill pass"');
    expect(html).toContain('>PASS<');
  });

  it('renders FAIL pill for failing rows + diff count', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [failRow] });
    expect(html).toContain('class="pill fail"');
    expect(html).toContain('>FAIL<');
    expect(html).toContain('>3<');
  });

  it('renders ERROR pill + error message for errored rows', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [errorRow] });
    expect(html).toContain('class="pill error"');
    expect(html).toContain('>ERROR<');
    expect(html).toContain('deploy HTTP 500');
  });

  it('emits show-diff button per row with folder data attribute', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [failRow] });
    expect(html).toContain(`data-action="showDiff"`);
    expect(html).toContain(`data-folder="/tests/A/t2"`);
  });

  it('renders Re-run all button always', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [passRow] });
    expect(html).toContain('data-action="rerunAll"');
  });

  it('renders Re-run failed button only when failures exist', () => {
    const allPass = renderSummaryHtml({ folderLabel: 'x', rows: [passRow] });
    expect(allPass).not.toContain('rerunFailed');

    const mixed = renderSummaryHtml({ folderLabel: 'x', rows: [passRow, failRow] });
    expect(mixed).toContain(`data-action="rerunFailed"`);
    expect(mixed).toContain('Re-run failed (1)');
  });

  it('escapes HTML in folder label + test name + error', () => {
    const evil: SummaryRow = {
      testFolder: '/x',
      testName: `<img src=x>`,
      pass: false,
      summary: failSummary,
      durationMs: 0,
      error: `<script>alert('e')</script>`,
    };
    const html = renderSummaryHtml({ folderLabel: `<x>`, rows: [evil] });
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain(`<script>alert`);
  });

  it('embeds CSP nonce when provided', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [passRow], cspNonce: 'n1', scriptUri: 'tiTestSummary.js' });
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(`nonce-n1`);
    expect(html).toContain(`<script nonce="n1" src="tiTestSummary.js"></script>`);
  });

  it('always emits a CSP meta; locks scripts to none when no nonce provided', () => {
    const html = renderSummaryHtml({ folderLabel: 'x', rows: [passRow] });
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'none'");
  });

  it('handles empty rows array', () => {
    const html = renderSummaryHtml({ folderLabel: 'empty', rows: [] });
    expect(html).toContain('0 tests');
    expect(html).toContain('0 pass');
    expect(html).not.toContain('rerunFailed');
  });
});
