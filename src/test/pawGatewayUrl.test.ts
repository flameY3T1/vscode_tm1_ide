import { describe, expect, it } from 'vitest';
import { pawInstanceUrl } from '../providers/adminDiscoveryPure';
import { PawGatewayError, normalizePawGatewayUrl } from '../tm1Rest/pawGatewayUrl';
import { pawTarget } from '../utils/pawTarget';

describe('normalizePawGatewayUrl', () => {
  it('normalizes surrounding whitespace and trailing slashes', () => {
    expect(normalizePawGatewayUrl('  https://paw.example:9443///  ')).toBe('https://paw.example:9443');
  });

  it.each([
    'ftp://paw.example',
    'https://user:secret@paw.example',
    'https://@paw.example',
    'https://paw.example/prefix',
    'https://paw.example/%2e/api',
    'https://paw.example?tenant=a',
    'https://paw.example#fragment',
    'https://paw.example\\api',
    'https://paw.example\r\n.evil.example',
    'https://paw.example\t.evil.example',
  ])('rejects a non-root HTTP(S) gateway URL: %s', (value) => {
    expect(() => normalizePawGatewayUrl(value)).toThrow(PawGatewayError);
  });
});

describe('pawInstanceUrl', () => {
  it.each([
    ['https://paw.example/', 'Sales Plan', 'https://paw.example/api/v1/tm1/Sales%20Plan'],
    ['http://paw.example:8080///', 'A#B/C', 'http://paw.example:8080/api/v1/tm1/A%23B%2FC'],
  ])('builds an encoded child URL', (baseUrl, name, expected) => {
    expect(pawInstanceUrl(baseUrl, name)).toBe(expected);
  });

  it.each(['', '   ', '.', '..'])('rejects an unsafe instance name: %j', (name) => {
    expect(() => pawInstanceUrl('https://paw.example', name)).toThrow(PawGatewayError);
  });

  it('validates the gateway root before deriving a child URL', () => {
    expect(() => pawInstanceUrl('https://paw.example/prefix', 'SALES')).toThrow(PawGatewayError);
  });

  it('turns an unpaired surrogate in an instance name into a named PAW error', () => {
    expect(() => pawInstanceUrl('https://paw.example', '\ud800')).toThrow(PawGatewayError);
  });
});

describe('PAW with a tenant', () => {
  it('builds the PA SaaS route shape and pawTarget reads it back', () => {
    const url = pawInstanceUrl('https://paw.example', 'SALES', 'AB12');
    expect(url).toBe('https://paw.example/api/AB12/v0/tm1/SALES');
    expect(pawTarget(url)).toEqual({ gateway: 'https://paw.example', instance: 'SALES' });
  });

  it('still reads the tenantless shape', () => {
    expect(pawTarget('https://paw.example/api/v1/tm1/SALES')).toEqual({ gateway: 'https://paw.example', instance: 'SALES' });
  });
});
