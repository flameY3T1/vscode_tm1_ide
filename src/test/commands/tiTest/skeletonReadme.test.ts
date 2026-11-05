import { describe, it, expect } from 'vitest';
import { buildTestReadme } from '../../../commands/tiTest/skeleton';

describe('buildTestReadme', () => {
  it('renders process name and test name in the header', () => {
    const md = buildTestReadme('LoadSales', 'sales-happy-path');
    expect(md).toContain('# TI Test: sales-happy-path');
    expect(md).toContain('Process: `LoadSales`');
  });

  it('sanitizes non-identifier characters in fileBase', () => {
    const md = buildTestReadme('Load Sales-2024!', 't');
    expect(md).toContain('Load_Sales_2024_.ti');
    expect(md).toContain('Load_Sales_2024_.params.txt');
    // Original process name still appears verbatim in the "Process: `…`" line
    // and deploy block; sanitization is filename-only.
    expect(md).toContain('Process: `Load Sales-2024!`');
  });

  it('truncates fileBase to 56 characters', () => {
    const long = 'A'.repeat(80);
    const md = buildTestReadme(long, 't');
    const expected = 'A'.repeat(56);
    expect(md).toContain(`${expected}.ti`);
    expect(md).toContain(`${expected}.params.txt`);
    expect(md).not.toContain('A'.repeat(57) + '.ti');
  });

  it('keeps process name unchanged in the deploy instructions block', () => {
    const md = buildTestReadme('Load Sales', 't');
    expect(md).toContain('original `Load Sales`');
  });

  it('says capture applies every write — never that writes are held back', () => {
    // Capture has been a full live run since 2026-10-29; a README promising
    // redirected writes would invite a capture against production.
    const md = buildTestReadme('P', 't');
    expect(md).toContain('Every cube/dim/attribute write is applied to TM1');
    expect(md).not.toMatch(/NOT applied|redirected to a log/);
  });

  it('references the simulator + Diff-Webview workflow', () => {
    const md = buildTestReadme('P', 't');
    expect(md).toMatch(/Simulate \(Client-side\)/);
    expect(md).toMatch(/Diff-Webview/);
  });
});
