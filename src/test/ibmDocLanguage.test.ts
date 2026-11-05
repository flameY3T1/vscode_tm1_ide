import { describe, it, expect, afterEach } from 'vitest';
import { buildIbmDocUrls, docUrlFor, setIbmDocLanguage, IBM_DOC_LANGUAGES } from '../tiLogicVisualizer/tiSignatures';

const buildIbmDocUrl = (name: string): string | undefined => buildIbmDocUrls(name).docUrl;

/**
 * IBM serves the Planning Analytics docs per language under `/docs/<lang>/`.
 * Measured against the live site on 2026-08-07:
 *   de, fr, es, it, ja, ko, zh, pt-br → real translated pages (HTTP 200)
 *   ru, nl                           → HTTP 200, English content
 *   an unknown code (e.g. "xx")      → HTTP 404
 *
 * So the code cannot be passed through blindly: an unsupported VS Code display
 * language would produce a dead link. Anything outside the measured set falls
 * back to English.
 */

afterEach(() => setIbmDocLanguage('en'));

describe('buildIbmDocUrl', () => {
  it('defaults to English', () => {
    expect(buildIbmDocUrl('CellGetN'))
      .toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-cellgetn');
  });

  it('uses the configured language where 2.1.0 serves it', () => {
    setIbmDocLanguage('zh');
    expect(buildIbmDocUrl('ROUNDP'))
      .toBe('https://www.ibm.com/docs/zh/planning-analytics/2.1.0?topic=functions-roundp');
  });

  it('falls back to English for languages that only 2.0.0 serves (measured 2026-10-07)', () => {
    setIbmDocLanguage('de');
    expect(buildIbmDocUrl('ROUNDP'))
      .toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-roundp');
    // A page that only exists under 2.0.0 keeps the translation.
    expect(buildIbmDocUrl('ExecuteJavaN'))
      .toBe('https://www.ibm.com/docs/de/planning-analytics/2.0.0?topic=functions-executejavan');
  });

  it('builds the 3.1.0 page for v12 and falls back across lines where IBM has only one', () => {
    expect(buildIbmDocUrls('CellGetN').docUrlV12)
      .toBe('https://www.ibm.com/docs/en/planning-analytics/3.1.0?topic=functions-cellgetn');
    // v12-only family: no 2.1.0 page, so both links point at 3.1.0.
    expect(buildIbmDocUrls('JsonAdd')).toEqual({
      docUrl: 'https://www.ibm.com/docs/en/planning-analytics/3.1.0?topic=functions-jsonadd',
      docUrlV12: 'https://www.ibm.com/docs/en/planning-analytics/3.1.0?topic=functions-jsonadd',
    });
    // Deprecated in v12 and gone from 3.1.0: the v12 link keeps the 2.1.0 page.
    expect(buildIbmDocUrls('SaveDataAll').docUrlV12)
      .toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-savedataall');
  });

  it('uses the measured topic where IBM does not file it under functions-', () => {
    expect(buildIbmDocUrl('DatasourceType'))
      .toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=variables-datasourcetype');
  });

  it('gives no link where IBM has no page in any version', () => {
    expect(buildIbmDocUrls('LockOn')).toEqual({});
  });

  it('docUrlFor picks the line', () => {
    const sig = buildIbmDocUrls('CellGetN');
    expect(docUrlFor(sig, false)).toContain('/2.1.0?');
    expect(docUrlFor(sig, true)).toContain('/3.1.0?');
  });

  it('falls back to English for a language IBM does not serve', () => {
    // Turkish is a VS Code display language but 404s on the IBM docs.
    setIbmDocLanguage('tr');
    expect(buildIbmDocUrl('ROUNDP'))
      .toBe('https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-roundp');
  });

  it('maps a regional VS Code code onto the base language IBM serves', () => {
    setIbmDocLanguage('de-CH');
    // Only 2.0.0 serves German, so check on a page that lives there.
    expect(buildIbmDocUrl('ExecuteJavaN')).toContain('/docs/de/');
  });

  it('keeps pt-br, which IBM serves as its own locale', () => {
    setIbmDocLanguage('pt-br');
    expect(buildIbmDocUrl('ROUNDP')).toContain('/docs/pt-br/');
  });

  it('maps both Chinese variants onto the served code', () => {
    setIbmDocLanguage('zh-cn');
    expect(buildIbmDocUrl('ROUNDP')).toContain('/docs/zh/');
    setIbmDocLanguage('zh-tw');
    expect(buildIbmDocUrl('ROUNDP')).toContain('/docs/zh/');
  });

  it('is case-insensitive about the incoming code', () => {
    setIbmDocLanguage('DE');
    // Only 2.0.0 serves German, so check on a page that lives there.
    expect(buildIbmDocUrl('ExecuteJavaN')).toContain('/docs/de/');
  });

  it('ignores an empty or undefined language instead of building a broken URL', () => {
    setIbmDocLanguage(undefined);
    expect(buildIbmDocUrl('ROUNDP')).toContain('/docs/en/');
    setIbmDocLanguage('');
    expect(buildIbmDocUrl('ROUNDP')).toContain('/docs/en/');
  });

  it('still slugifies the function name', () => {
    expect(buildIbmDocUrl('NumberToStringEx')).toBe(
      'https://www.ibm.com/docs/en/planning-analytics/2.1.0?topic=functions-numbertostringex');
  });

  it('exposes only languages that were measured as serving a page', () => {
    expect(IBM_DOC_LANGUAGES.has('de')).toBe(true);
    expect(IBM_DOC_LANGUAGES.has('xx')).toBe(false);
  });
});
