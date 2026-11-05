import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

const apiRequestSpy = vi.hoisted(() => vi.fn());
// Both paths on the same double: `tm1Rest/serverLanguageApi` imports the
// transport directly (the facade is forbidden to the deep layers); a mock
// on `tm1Client` alone would let the fetch run into the real network.
vi.mock('../../tm1Rest/client', () => ({ apiRequest: apiRequestSpy, assertOk: () => {} }));

import { classifyLogLanguage, normalizeLanguageTag } from '../../commands/serverLanguagePure';
import { fetchServerLanguage, _findLanguageLeafForTest } from '../../tm1Rest/serverLanguageApi';
import {
  messageLogLanguageHint, clearLanguageHintCache, _clearLanguageHintCacheForTest,
} from '../../commands/messageLogLanguageHint';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = { serverUrl: 'https://h:1', username: 'u', authType: 'Basic' } as unknown as Tm1Config;

function ok(obj: unknown) { return { statusCode: 200, body: JSON.stringify(obj) }; }

/**
 * EVERY call gets a FRESH response object.
 *
 * `mockResolvedValue(ok(...))` would hand out the same object twice, and
 * `parseBodySafe` releases the body after parsing (`res.body = ''`, the
 * memory pattern from docs/architecture/memory-optimizations.md). The second fetch would then see an empty
 * response — an error that only the mock has, but that fakes
 * real findings.
 */
function alwaysOk(obj: unknown) {
  return async () => ok(obj);
}

describe('classifyLogLanguage', () => {
  it.each(['EN', 'en', 'eng', 'English', 'en-US', 'DE', 'ger', 'deu', 'de_DE'])(
    'carries %s', (tag) => { expect(classifyLogLanguage(tag)).toBe('supported'); },
  );

  it.each(['FR', 'fra', 'esp', 'jpn', 'chs', 'pt-BR'])(
    'warns for %s', (tag) => { expect(classifyLogLanguage(tag)).toBe('unsupported'); },
  );

  it('stays silent when the language could not be read', () => {
    // `unknown` is NOT a warning case: it means "we do not know", not
    // "the language does not fit".
    expect(classifyLogLanguage(undefined)).toBe('unknown');
    expect(classifyLogLanguage('')).toBe('unknown');
    expect(classifyLogLanguage('   ')).toBe('unknown');
  });

  it('cuts off the regional suffix', () => {
    // A de-AT server writes the same German messages as a de-DE one.
    expect(normalizeLanguageTag('de-AT')).toBe('de');
    expect(normalizeLanguageTag(' EN_us ')).toBe('en');
  });
});

describe('findLanguageLeaf', () => {
  it('finds the leaf nested as well as flat', () => {
    expect(_findLanguageLeafForTest({ Administration: { Language: 'FR' } })).toBe('FR');
    expect(_findLanguageLeafForTest({ Language: 'EN' })).toBe('EN');
  });

  it('skips empty values and non-strings', () => {
    expect(_findLanguageLeafForTest({ Administration: { Language: '' } })).toBeUndefined();
    expect(_findLanguageLeafForTest({ Language: null })).toBeUndefined();
    expect(_findLanguageLeafForTest({})).toBeUndefined();
  });

  it('gives up on too deep nesting instead of searching arbitrarily far', () => {
    let node: Record<string, unknown> = { Language: 'FR' };
    for (let i = 0; i < 9; i++) { node = { level: node }; }
    expect(_findLanguageLeafForTest(node)).toBeUndefined();
  });
});

describe('fetchServerLanguage', () => {
  beforeEach(() => { apiRequestSpy.mockReset(); });

  it('reads ActiveConfiguration first', async () => {
    apiRequestSpy.mockImplementation(alwaysOk({ Administration: { Language: 'FR' } }));
    expect(await fetchServerLanguage(CFG)).toBe('FR');
    expect(apiRequestSpy.mock.calls[0][1]).toBe('ActiveConfiguration');
  });

  it('falls back to the flat view when the nested one is missing', async () => {
    apiRequestSpy
      .mockResolvedValueOnce({ statusCode: 404, body: '' })
      .mockResolvedValueOnce(ok({ Language: 'ger' }));
    expect(await fetchServerLanguage(CFG)).toBe('ger');
    expect(apiRequestSpy.mock.calls[1][1]).toBe('Configuration');
  });

  it('answers "unknown" instead of throwing when both paths fail', async () => {
    // 403 is the real case: the language is under `Administration`, and
    // not every user is allowed to read that.
    apiRequestSpy.mockResolvedValue({ statusCode: 403, body: '' });
    expect(await fetchServerLanguage(CFG)).toBeUndefined();
  });

  it('answers "unknown" on a network error too', async () => {
    apiRequestSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchServerLanguage(CFG)).toBeUndefined();
  });
});

describe('messageLogLanguageHint', () => {
  beforeEach(() => { apiRequestSpy.mockReset(); _clearLanguageHintCacheForTest(); });

  it('names the language and says what the analysis reads', async () => {
    apiRequestSpy.mockImplementation(alwaysOk({ Administration: { Language: 'FR' } }));
    const hint = await messageLogLanguageHint(CFG);
    expect(hint).toContain('FR');
    expect(hint).toContain('English and German');
  });

  it('stays silent for an English and for a German server', async () => {
    apiRequestSpy.mockImplementation(alwaysOk({ Administration: { Language: 'DE' } }));
    expect(await messageLogLanguageHint(CFG)).toBeUndefined();
  });

  it('stays silent when the language could not be read', async () => {
    // Do not build a warning out of a knowledge gap.
    apiRequestSpy.mockResolvedValue({ statusCode: 401, body: '' });
    expect(await messageLogLanguageHint(CFG)).toBeUndefined();
  });

  it('asks a server once, even when both analyses open', async () => {
    apiRequestSpy.mockImplementation(alwaysOk({ Administration: { Language: 'FR' } }));
    const [a, b] = await Promise.all([messageLogLanguageHint(CFG), messageLogLanguageHint(CFG)]);
    expect(a).toBe(b);
    expect(apiRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('asks again after disconnecting', async () => {
    // Between disconnecting and reconnecting there is room for a server restart with a different
    // `tm1s.cfg`.
    apiRequestSpy.mockImplementation(alwaysOk({ Administration: { Language: 'FR' } }));
    await messageLogLanguageHint(CFG);
    clearLanguageHintCache(CFG.serverUrl);
    await messageLogLanguageHint(CFG);
    expect(apiRequestSpy).toHaveBeenCalledTimes(2);
  });
});
