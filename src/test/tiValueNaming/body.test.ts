import { describe, it, expect } from 'vitest';
import { VALUENAMING_CSS, valueNamingBody } from '../../webviews/tiValueNamingBody';
import { buildValueNamingL10n } from '../../webviews/tiValueNamingL10n';

// Regression test mirroring tiConsistency/body.test.ts: VALUENAMING_CSS and
// valueNamingBody() are interpolated DIRECTLY into <style>/<body> by
// renderWebviewShell (no re-parsing) — they must contain REAL newline
// characters, not the literal two-character sequence backslash+n, and must
// not carry the CSP/theme footguns the Phase-2 multi-value section could
// have reintroduced (bare `color-scheme: light dark`, `unsafe-inline`).
describe('tiValueNamingBody — Phase-2 multi-value section', () => {
  it('VALUENAMING_CSS contains the multi-value split UI rules', () => {
    expect(VALUENAMING_CSS).toContain('.mv-var');
    expect(VALUENAMING_CSS).toContain('.refused');
  });

  it('VALUENAMING_CSS contains real newlines, not literal backslash-n', () => {
    expect(VALUENAMING_CSS.includes('\n')).toBe(true);
    expect(VALUENAMING_CSS.includes('\\n')).toBe(false);
  });

  it('VALUENAMING_CSS does not carry unsafe-inline or a forced color-scheme', () => {
    expect(VALUENAMING_CSS).not.toContain('unsafe-inline');
    expect(VALUENAMING_CSS).not.toContain('color-scheme: light dark');
  });

  it('valueNamingBody() renders the #multiValue container', () => {
    const body = valueNamingBody(buildValueNamingL10n());
    expect(body).toContain('id="multiValue"');
  });

  it('valueNamingBody() contains real newlines, not literal backslash-n', () => {
    const body = valueNamingBody(buildValueNamingL10n());
    expect(body.includes('\n')).toBe(true);
    expect(body.includes('\\n')).toBe(false);
  });

  it('L10n exposes the two tab labels', () => {
    const l = buildValueNamingL10n();
    expect(l.tabValueNames).toBeTruthy();
    expect(l.tabMultiValue).toBeTruthy();
  });

  it('L10n exposes the exclude UI strings', () => {
    const l = buildValueNamingL10n();
    expect(l.excludeHeading).toBeTruthy();
    expect(l.excludePlaceholder).toBeTruthy();
    expect(l.excludeAddBtn).toBeTruthy();
  });

  it('valueNamingBody() renders the tab bar and panels, drops the h3 heading', () => {
    const body = valueNamingBody(buildValueNamingL10n());
    expect(body).toContain('id="tabGroups"');
    expect(body).toContain('id="tabMulti"');
    expect(body).toContain('id="cntGroups"');
    expect(body).toContain('id="cntMulti"');
    expect(body).toContain('id="groups" class="tab-panel active"');
    expect(body).toContain('id="multiValue" class="tab-panel"');
    expect(body).not.toContain('section-h');
  });

  it('VALUENAMING_CSS contains tab + process-group rules', () => {
    expect(VALUENAMING_CSS).toContain('.tabs');
    expect(VALUENAMING_CSS).toContain('.tab.active');
    expect(VALUENAMING_CSS).toContain('.mv-proc-head');
    expect(VALUENAMING_CSS).not.toContain('.section-h');
  });

  it('valueNamingBody() renders the exclude UI above the tabs', () => {
    const body = valueNamingBody(buildValueNamingL10n());
    expect(body).toContain('id="excludeInput"');
    expect(body).toContain('id="excludeAddBtn"');
    expect(body).toContain('id="excludeChips"');
    expect(body.indexOf('id="excludeChips"')).toBeLessThan(body.indexOf('class="tabs"'));
  });

  it('VALUENAMING_CSS contains exclude-chip rules', () => {
    expect(VALUENAMING_CSS).toContain('.exclude-chip');
  });
});
