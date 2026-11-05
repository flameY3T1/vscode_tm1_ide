import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildCubeElementIndex,
  _clearCacheForTest,
  type ApiRequestFn,
} from '../../elementQualifier/cubeElementIndex';

describe('buildCubeElementIndex — alias + whitespace', () => {
  beforeEach(() => _clearCacheForTest());

  function api(elements: unknown[]): ApiRequestFn {
    return async (_m, path) => {
      if (path.includes('/Dimensions')) {
        return { statusCode: 200, body: JSON.stringify({ value: [{ Name: 'Period' }] }) };
      }
      if (path.includes('/Elements')) {
        return { statusCode: 200, body: JSON.stringify({ value: elements }) };
      }
      return { statusCode: 200, body: JSON.stringify({ value: [] }) };
    };
  }

  it('indexes element names whitespace-insensitively', async () => {
    const idx = await buildCubeElementIndex('C', 'k', api([{ Name: 'Jan 2024' }]));
    expect(idx.elemToDims.get('jan2024')).toEqual(['Period']);
  });

  it('indexes alias attribute values as lookup keys', async () => {
    const idx = await buildCubeElementIndex(
      'C',
      'k',
      api([{ Name: '0001', Attributes: { Alias: 'Cost Center A', Code: 42 } }]),
    );
    expect(idx.elemToDims.get('0001')).toEqual(['Period']);
    expect(idx.elemToDims.get('costcentera')).toEqual(['Period']);
    // numeric attribute must NOT become a key
    expect(idx.elemToDims.get('42')).toBeUndefined();
  });
});
