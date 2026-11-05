import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  assertOk: vi.fn((res: any, ctx?: string) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const prefix = ctx ? `${ctx}: ` : '';
      throw new Error(`${prefix}HTTP ${res.statusCode}: ${res.body}`);
    }
  }),
}));
vi.mock('../commands/serverManager', () => ({
  getServerConfig: vi.fn(),
  getServerNameByUrl: vi.fn(() => undefined),
}));
vi.mock('../providers/fetchNames', () => ({
  fetchNames: vi.fn(),
  invalidateCache: vi.fn(),
}));

import { apiRequest } from '../tm1Rest/client';
import { getServerConfig } from '../commands/serverManager';
import { fetchNames, invalidateCache } from '../providers/fetchNames';
import {
  validateCubeName,
  validateCubeDims,
  buildCubeBody,
  submitCubeCreate,
  getCreateCubeHtml,
} from '../commands/cubeViewer/createCube';

const FAKE_CFG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'basic' } as any;

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(getServerConfig).mockReset().mockReturnValue(FAKE_CFG);
  vi.mocked(fetchNames).mockReset().mockResolvedValue([]);
  vi.mocked(invalidateCache).mockReset();
  (vscode.window as any).showErrorMessage = vi.fn().mockResolvedValue(undefined);
  (vscode.window as any).showInformationMessage = vi.fn().mockResolvedValue(undefined);
});

describe('validateCubeName', () => {
  it('rejects empty / whitespace', () => {
    expect(validateCubeName('', [])).toBeTruthy();
    expect(validateCubeName('   ', [])).toBeTruthy();
  });

  it('rejects non-letter start + bad chars', () => {
    expect(validateCubeName('1Bad', [])).toBeTruthy();
    expect(validateCubeName('Bad-Name', [])).toBeTruthy();
    expect(validateCubeName("Bad'", [])).toBeTruthy();
  });

  it('rejects duplicate (case-insensitive)', () => {
    expect(validateCubeName('Sales', ['SALES'])).toBeTruthy();
  });

  it('accepts valid', () => {
    expect(validateCubeName('Sales', [])).toBeUndefined();
    expect(validateCubeName('My_Cube 2', [])).toBeUndefined();
  });
});

describe('validateCubeDims', () => {
  it('rejects fewer than 2 dims', () => {
    expect(validateCubeDims([], ['A', 'B'])).toBeTruthy();
    expect(validateCubeDims(['A'], ['A', 'B'])).toBeTruthy();
  });

  it('rejects unknown dims', () => {
    expect(validateCubeDims(['A', 'X'], ['A', 'B'])).toBeTruthy();
  });

  it('rejects duplicate dims in selection', () => {
    expect(validateCubeDims(['A', 'A'], ['A', 'B'])).toBeTruthy();
  });

  it('accepts valid 2+ unique dims', () => {
    expect(validateCubeDims(['A', 'B'], ['A', 'B', 'C'])).toBeUndefined();
    expect(validateCubeDims(['C', 'A', 'B'], ['A', 'B', 'C'])).toBeUndefined();
  });
});

describe('buildCubeBody', () => {
  it('preserves dim order in @odata.bind', () => {
    const body = JSON.parse(buildCubeBody('Sales', ['Year', 'Region', 'Measure']));
    expect(body.Name).toBe('Sales');
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('Year')",
      "Dimensions('Region')",
      "Dimensions('Measure')",
    ]);
  });

  it("escapes single quotes in dim names", () => {
    const body = JSON.parse(buildCubeBody('C', ["O'Reilly", 'B']));
    expect(body['Dimensions@odata.bind'][0]).toBe("Dimensions('O''Reilly')");
  });

  it('URL-encodes reserved chars in the bind path (bind = resource path, not literal)', () => {
    const dim = "A/B#C?D'E F";
    const body = JSON.parse(buildCubeBody('C', [dim]));
    expect(body['Dimensions@odata.bind'][0]).toBe("Dimensions('A%2FB%23C%3FD''E%20F')");
  });

  it('leaves Name raw — it is a property value, not a resource path', () => {
    const body = JSON.parse(buildCubeBody("A/B#C?D'E F", ['X', 'Y']));
    expect(body.Name).toBe("A/B#C?D'E F");
  });
});

describe('submitCubeCreate', () => {
  it('happy-path: POST Cubes + refresh + cache invalidate', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 201, body: '{}' });
    const refresh = vi.fn();

    const ok = await submitCubeCreate('Sales', ['A', 'B'], FAKE_CFG, refresh);

    expect(ok).toBe(true);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, path, body] = vi.mocked(apiRequest).mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('Cubes');
    const parsed = JSON.parse(body as string);
    expect(parsed.Name).toBe('Sales');
    expect(parsed['Dimensions@odata.bind']).toEqual([
      "Dimensions('A')",
      "Dimensions('B')",
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(invalidateCache).toHaveBeenCalledWith('Cubes', FAKE_CFG.serverUrl);
  });

  it('returns false on REST failure + shows error + no refresh', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 400, body: '{"error":{"message":"bad"}}' });
    const refresh = vi.fn();

    const ok = await submitCubeCreate('Bad', ['A', 'B'], FAKE_CFG, refresh);

    expect(ok).toBe(false);
    expect((vscode.window as any).showErrorMessage).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('getCreateCubeHtml', () => {
  it('contains cube name input + dim list placeholders', () => {
    const html = getCreateCubeHtml(['A', 'B', 'C'], 'vscode-resource:', 'bundle.js');
    expect(html).toContain('id="cubeName"');
    expect(html).toContain('id="dimList"');
    expect(html).toContain('id="selectedList"');
    expect(html).toContain('id="submit"');
    expect(html).toContain('id="cancel"');
  });

  it('serializes dimensions as JSON for client init', () => {
    const html = getCreateCubeHtml(['Year', 'Region'], 'vscode-resource:', 'bundle.js');
    expect(html).toContain('"Year"');
    expect(html).toContain('"Region"');
  });

  it('escapes potential script-injection in dim names', () => {
    const html = getCreateCubeHtml(['<script>alert(1)</script>'], 'vscode-resource:', 'bundle.js');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
