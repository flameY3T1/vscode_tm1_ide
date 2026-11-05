import { describe, it, expect } from 'vitest';
import { CONSISTENCY_CSS, consistencyBody } from '../../webviews/tiConsistencyBody';
import { buildConsistencyL10n } from '../../webviews/tiConsistencyL10n';

// Regression test for a Critical review finding: CONSISTENCY_CSS and
// consistencyBody() are interpolated DIRECTLY into <style>/<body> by
// renderWebviewShell (no re-parsing) — they must contain REAL newline
// characters, not the literal two-character sequence backslash+n that
// `.join('\\n')` (double-backslash) would produce.
describe('tiConsistencyBody', () => {
  it('CONSISTENCY_CSS contains real newlines, not literal backslash-n', () => {
    expect(CONSISTENCY_CSS.includes('\n')).toBe(true);
    expect(CONSISTENCY_CSS.includes('\\n')).toBe(false);
  });

  it('consistencyBody() contains real newlines, not literal backslash-n', () => {
    const body = consistencyBody(buildConsistencyL10n());
    expect(body.includes('\n')).toBe(true);
    expect(body.includes('\\n')).toBe(false);
  });
});
