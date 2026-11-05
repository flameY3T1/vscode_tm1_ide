import { describe, it, expect } from 'vitest';
import { localeChain, localeAssetNames } from '../../utils/localeChain';

describe('localeChain', () => {
  it('splits a regional language into exact -> coarse', () => {
    expect(localeChain('pt-br')).toEqual(['pt-br', 'pt']);
    expect(localeChain('zh-CN')).toEqual(['zh-cn', 'zh']);
  });

  it('returns only one level for a base language, not two identical ones', () => {
    expect(localeChain('de')).toEqual(['de']);
    expect(localeChain('pl')).toEqual(['pl']);
  });

  it('leaves English out — it is the source, not a translation', () => {
    expect(localeChain('en')).toEqual([]);
    expect(localeChain('en-US')).toEqual([]);
  });

  it('falls back to the empty chain when the value is missing or empty', () => {
    expect(localeChain(undefined)).toEqual([]);
    expect(localeChain('')).toEqual([]);
    expect(localeChain('   ')).toEqual([]);
  });

  it('also accepts the underscore as a separator (pt_BR)', () => {
    expect(localeChain('pt_BR')).toEqual(['pt_br', 'pt']);
  });
});

describe('localeAssetNames', () => {
  it('ALWAYS appends the English source as the last fallback', () => {
    expect(localeAssetNames('tiSignatureDocs', 'json', 'pt-br')).toEqual([
      'tiSignatureDocs.pt-br.json',
      'tiSignatureDocs.pt.json',
      'tiSignatureDocs.json',
    ]);
    expect(localeAssetNames('tiSignatureDocs', 'json', 'en')).toEqual([
      'tiSignatureDocs.json',
    ]);
  });
});
