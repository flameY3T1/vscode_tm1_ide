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
vi.mock('../commands/serverManager', async () => {
  const { serverManagerMock } = await import('./helpers/serverManagerMock');
  return serverManagerMock();
});
vi.mock('../providers/fetchNames', () => ({
  fetchNames: vi.fn(),
  invalidateCache: vi.fn(),
}));
vi.mock('../commands/dimension/dimensionEditor', () => ({
  DimensionEditorManager: { open: vi.fn().mockResolvedValue(undefined) },
}));

import { apiRequest } from '../tm1Rest/client';
import { getServerConfig } from '../commands/serverManager';
import { fetchNames, invalidateCache } from '../providers/fetchNames';
import { DimensionEditorManager } from '../commands/dimension/dimensionEditor';
import { createDimensionCommand } from '../commands/dimension/createDimension';
import { validateDimName } from '../dimensionEditor/dimNameValidation';

const win = vscode.window as any;

const FAKE_CFG = { serverUrl: 'http://srv', username: 'u', password: '', authType: 'basic' } as any;

function fakeNode(serverId = 'srv'): any {
  return { nodeType: 'category-dimensions', meta: { serverId } };
}

const refresh = vi.fn();

beforeEach(() => {
  vi.mocked(apiRequest).mockReset();
  vi.mocked(getServerConfig).mockReset().mockReturnValue(FAKE_CFG);
  vi.mocked(fetchNames).mockReset().mockResolvedValue([]);
  vi.mocked(invalidateCache).mockReset();
  vi.mocked(DimensionEditorManager.open).mockReset().mockResolvedValue(undefined);
  refresh.mockReset();
  win.showInputBox = vi.fn();
  win.showErrorMessage = vi.fn().mockResolvedValue(undefined);
  win.showInformationMessage = vi.fn().mockResolvedValue(undefined);
  win.showWarningMessage = vi.fn().mockResolvedValue(undefined);
});

describe('validateDimName', () => {
  it('rejects empty', () => {
    expect(validateDimName('', [])).toBeTruthy();
    expect(validateDimName('  ', [])).toBeTruthy();
  });

  it('rejects non-letter start', () => {
    expect(validateDimName('1Bad', [])).toBeTruthy();
    expect(validateDimName('_bad', [])).toBeTruthy();
  });

  it('rejects bad characters', () => {
    expect(validateDimName('Bad-Name', [])).toBeTruthy();
    expect(validateDimName('Bad.Name', [])).toBeTruthy();
    expect(validateDimName("Bad'Name", [])).toBeTruthy();
  });

  it('accepts valid names', () => {
    expect(validateDimName('Year', [])).toBeUndefined();
    expect(validateDimName('My_Dim 2', [])).toBeUndefined();
    expect(validateDimName('A1', [])).toBeUndefined();
  });

  it('rejects duplicates (case-insensitive)', () => {
    expect(validateDimName('Year', ['Year'])).toBeTruthy();
    expect(validateDimName('YEAR', ['year'])).toBeTruthy();
  });

  it('rejects too long (>255)', () => {
    expect(validateDimName('A' + 'b'.repeat(255), [])).toBeTruthy();
  });
});

describe('createDimensionCommand', () => {
  it('cancels silently if no name entered', async () => {
    win.showInputBox.mockResolvedValue(undefined);
    await createDimensionCommand(fakeNode(), refresh);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(DimensionEditorManager.open).not.toHaveBeenCalled();
  });

  it('shows error and aborts when no server config', async () => {
    vi.mocked(getServerConfig).mockReturnValue(undefined as any);
    await createDimensionCommand(fakeNode(), refresh);
    expect(win.showErrorMessage).toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('happy-path: posts to Dimensions, opens editor, refreshes tree', async () => {
    win.showInputBox.mockResolvedValue('NewDim');
    vi.mocked(fetchNames).mockResolvedValue(['Existing']);
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 201, body: '{}' });

    await createDimensionCommand(fakeNode(), refresh);

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [method, path, body] = vi.mocked(apiRequest).mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe('Dimensions');
    expect(JSON.parse(body as string)).toEqual({
      Name: 'NewDim',
      Hierarchies: [{ Name: 'NewDim', Elements: [] }],
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(invalidateCache).toHaveBeenCalledWith('Dimensions', FAKE_CFG.serverUrl);
    expect(DimensionEditorManager.open).toHaveBeenCalledWith('NewDim', FAKE_CFG);
    expect(win.showInformationMessage).toHaveBeenCalled();
  });

  it('shows error on REST failure and does not open editor', async () => {
    win.showInputBox.mockResolvedValue('Foo');
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 400, body: '{"error":{"message":"bad"}}' });

    await createDimensionCommand(fakeNode(), refresh);

    expect(win.showErrorMessage).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(DimensionEditorManager.open).not.toHaveBeenCalled();
  });

  it('passes existing names to validateInput so duplicates are blocked at input time', async () => {
    vi.mocked(fetchNames).mockResolvedValue(['Year', 'Month']);
    win.showInputBox.mockImplementation(async (opts: any) => {
      const err = opts?.validateInput?.('Year');
      expect(err).toBeTruthy();
      const ok = opts?.validateInput?.('Brand_New');
      expect(ok).toBeUndefined();
      return undefined;
    });

    await createDimensionCommand(fakeNode(), refresh);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('trims whitespace from name before posting', async () => {
    win.showInputBox.mockResolvedValue('  Padded  ');
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 201, body: '{}' });

    await createDimensionCommand(fakeNode(), refresh);

    const body = JSON.parse(vi.mocked(apiRequest).mock.calls[0][2] as string);
    expect(body.Name).toBe('Padded');
    expect(body.Hierarchies[0].Name).toBe('Padded');
    expect(DimensionEditorManager.open).toHaveBeenCalledWith('Padded', FAKE_CFG);
  });
});
