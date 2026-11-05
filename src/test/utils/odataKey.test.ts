import { describe, it, expect } from 'vitest';
import { escapeODataKey, encodeODataKey } from '../../utils/odataKey';

describe('escapeODataKey', () => {
  it('verdoppelt einzelne Apostrophe', () => {
    expect(escapeODataKey("O'Brien")).toBe("O''Brien");
  });

  it('verdoppelt mehrere Apostrophe', () => {
    expect(escapeODataKey("Dep't 'X'")).toBe("Dep''t ''X''");
  });

  it('leaves strings without an apostrophe unchanged', () => {
    expect(escapeODataKey('Plain Name 123')).toBe('Plain Name 123');
  });

  it('an empty string stays empty', () => {
    expect(escapeODataKey('')).toBe('');
  });
});

describe('encodeODataKey', () => {
  it('quote-doubling + URL-Encoding kombiniert', () => {
    expect(encodeODataKey("O'Brien")).toBe("O''Brien");
  });

  it('URL-encodes special characters after the doubling', () => {
    expect(encodeODataKey("A&B's #1")).toBe("A%26B''s%20%231");
  });

  it('umlauts are percent-encoded', () => {
    expect(encodeODataKey('Größe')).toBe('Gr%C3%B6%C3%9Fe');
  });

  it('TM1 control object prefix } stays preserved URL-encoded', () => {
    expect(encodeODataKey('}ElementSecurity_Dim')).toBe('%7DElementSecurity_Dim');
  });
});
