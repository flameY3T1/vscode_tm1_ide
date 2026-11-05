import { describe, it, expect } from 'vitest';
import { buildTestReadme } from '../../commands/tiTest/skeleton';

describe('buildTestReadme', () => {
  it('includes process name and test name in header', () => {
    const md = buildTestReadme('MyProc', 'Smoke');
    expect(md).toContain('# TI Test: Smoke');
    expect(md).toContain('Process: `MyProc`');
  });

  it('sanitizes process name for filename base', () => {
    const md = buildTestReadme('My Proc-with.chars', 'T');
    expect(md).toContain('My_Proc_with_chars.ti');
    expect(md).toContain('My_Proc_with_chars.params.txt');
  });

  it('clamps fileBase length to 56 chars', () => {
    const longName = 'A'.repeat(100);
    const md = buildTestReadme(longName, 'T');
    const expected = 'A'.repeat(56);
    expect(md).toContain(`${expected}.ti`);
    expect(md).not.toContain('A'.repeat(57) + '.ti');
  });

  it('warns that capture runs the process live on TM1, with consequences', () => {
    const md = buildTestReadme('P', 'T');
    expect(md).toContain('RUNS THE PROCESS LIVE ON TM1');
    expect(md).toContain('sub-processes'); // consequence: subs run for real → DB write
    expect(md).toContain('GetProcessName()'); // consequence: rewritten to original name
  });

  it('describes auto-import + standalone fallback steps', () => {
    const md = buildTestReadme('P', 'T');
    expect(md).toContain('## How the test is populated');
    expect(md).toContain("ErrorLogFiles('<name>')/Content");
    expect(md).toContain('### Standalone fallback (if auto-import failed)');
    expect(md).toContain('### Run the simulator');
  });

  it('references the TM1ProcessError_*.log server files + local data/ targets', () => {
    const md = buildTestReadme('P', 'T');
    expect(md).toContain('TM1ProcessError_P_output.log');
    expect(md).toContain('TM1ProcessError_P_source.log');
    expect(md).toContain('data/P_log.txt');
    expect(md).toContain('data/P_source.txt');
  });

  it('mentions manifest.json toggle for active/inactive', () => {
    const md = buildTestReadme('P', 'T');
    expect(md).toContain('manifest.json');
    expect(md).toContain('active: false');
  });

  it('returns single string with newline separators', () => {
    const md = buildTestReadme('P', 'T');
    expect(typeof md).toBe('string');
    expect(md.split('\n').length).toBeGreaterThan(20);
  });

  it('replaces special chars with underscores in fileBase', () => {
    const md = buildTestReadme('a/b\\c?d', 'T');
    expect(md).toContain('a_b_c_d.ti');
  });
});
