import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../tm1Rest/client';
import { fetchRulesText, pushRulesText } from '../../git/rulesApi';
import { ObjectNotFoundError } from '../../git/processFetcher';

const mockApi = vi.mocked(apiRequest);
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG: Tm1Config = { serverUrl: 'http://tm1:8001', username: 'u', password: 'p', rejectUnauthorized: false, authType: 'Basic' };

beforeEach(() => { mockApi.mockReset(); });

describe('rulesApi', () => {
  describe('fetchRulesText', () => {
    it('GETs Cubes(...)/Rules and returns rules from {value: ...} shape (TM1 actual)', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ '@odata.context': '...', value: "['A'] = N: 1;" }),
      } as any);

      const text = await fetchRulesText('SalesCube', CFG);
      expect(text).toBe("['A'] = N: 1;");

      const [method, path] = mockApi.mock.calls[0];
      expect(method).toBe('GET');
      expect(path).toBe(`Cubes('${encodeURIComponent('SalesCube')}')/Rules`);
    });

    it('falls back to {Rules: ...} shape if present', async () => {
      mockApi.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ Rules: "['B'] = N: 2;" }),
      } as any);
      expect(await fetchRulesText('Cube', CFG)).toBe("['B'] = N: 2;");
    });

    it('returns empty string when Rules property is missing', async () => {
      mockApi.mockResolvedValue({ statusCode: 200, body: '{}' } as any);
      expect(await fetchRulesText('Empty', CFG)).toBe('');
    });

    it('returns empty string when body is empty/non-JSON', async () => {
      mockApi.mockResolvedValue({ statusCode: 200, body: '' } as any);
      expect(await fetchRulesText('Bare', CFG)).toBe('');
    });

    it('throws ObjectNotFoundError on 404', async () => {
      mockApi.mockResolvedValue({ statusCode: 404, body: '' } as any);
      await expect(fetchRulesText('Missing', CFG)).rejects.toThrow(ObjectNotFoundError);
    });
  });

  describe('pushRulesText', () => {
    it('PATCHes Cubes(...) with {Rules: text}', async () => {
      mockApi.mockResolvedValue({ statusCode: 204, body: '' } as any);
      await pushRulesText('SalesCube', "['A'] = N: 5;", CFG);

      const [method, path, body] = mockApi.mock.calls[0];
      expect(method).toBe('PATCH');
      expect(path).toBe(`Cubes('${encodeURIComponent('SalesCube')}')`);
      expect(JSON.parse(body as string)).toEqual({ Rules: "['A'] = N: 5;" });
    });

    it('throws on 5xx error', async () => {
      mockApi.mockResolvedValue({ statusCode: 500, body: 'oops' } as any);
      await expect(pushRulesText('X', 'rules', CFG)).rejects.toThrow(/HTTP 500/);
    });

    it('throws ObjectNotFoundError on 404', async () => {
      mockApi.mockResolvedValue({ statusCode: 404, body: '' } as any);
      await expect(pushRulesText('Missing', 'rules', CFG)).rejects.toThrow(ObjectNotFoundError);
    });

    it('encodes cube name in path', async () => {
      mockApi.mockResolvedValue({ statusCode: 204, body: '' } as any);
      await pushRulesText("Sales'Cube", 'rules', CFG);
      const [, path] = mockApi.mock.calls[0];
      expect(path).toContain(`Cubes('Sales''Cube')`);
    });
  });
});
