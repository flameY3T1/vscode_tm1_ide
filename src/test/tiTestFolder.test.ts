import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';

import {
  validateFolderName,
  listExistingTiTestFolders,
  createTiTestFolder,
  createFolderCommand,
  pickFolderForCapture,
} from '../commands/tiTest/tiTestFolder';

describe('validateFolderName', () => {
  it('rejects empty / whitespace', () => {
    expect(validateFolderName('')).toBeTruthy();
    expect(validateFolderName('   ')).toBeTruthy();
  });

  it('rejects . and ..', () => {
    expect(validateFolderName('.')).toBeTruthy();
    expect(validateFolderName('..')).toBeTruthy();
  });

  it('rejects slashes', () => {
    expect(validateFolderName('a/b')).toBeTruthy();
    expect(validateFolderName('a\\b')).toBeTruthy();
  });

  it('rejects bad starting char + bad chars', () => {
    expect(validateFolderName('-Leading')).toBeTruthy();
    expect(validateFolderName('.HiddenLike')).toBeTruthy();
    expect(validateFolderName('foo*')).toBeTruthy();
    expect(validateFolderName('foo?')).toBeTruthy();
  });

  it('trims leading/trailing whitespace before validation', () => {
    expect(validateFolderName(' Leading ')).toBeUndefined();
  });

  it('accepts valid', () => {
    expect(validateFolderName('Smoke')).toBeUndefined();
    expect(validateFolderName('Smoke_Tests')).toBeUndefined();
    expect(validateFolderName('My Tests 1.0')).toBeUndefined();
    expect(validateFolderName('A-B')).toBeUndefined();
  });

  it('rejects duplicate sibling (case-insensitive)', () => {
    expect(validateFolderName('Smoke', ['SMOKE'])).toBeTruthy();
    expect(validateFolderName('Other', ['SMOKE'])).toBeUndefined();
  });

  it('rejects too long', () => {
    expect(validateFolderName('A' + 'b'.repeat(128))).toBeTruthy();
  });
});

describe('createTiTestFolder + listExistingTiTestFolders (real fs)', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tititest-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('createTiTestFolder creates dir and returns absolute path', async () => {
    const out = await createTiTestFolder({ rootFolder: tmp, parentRel: '', name: 'A' });
    expect(out).toBe(path.join(tmp, 'A'));
    const stat = await fs.stat(out);
    expect(stat.isDirectory()).toBe(true);
  });

  it('creates nested with parentRel', async () => {
    await fs.mkdir(path.join(tmp, 'P'), { recursive: true });
    const out = await createTiTestFolder({ rootFolder: tmp, parentRel: 'P', name: 'Sub' });
    expect(out).toBe(path.join(tmp, 'P', 'Sub'));
  });

  it('listExistingTiTestFolders returns root only on empty tree', async () => {
    const list = await listExistingTiTestFolders(tmp);
    expect(list).toEqual(['']);
  });

  it('lists all container folders, excludes test leaves (folders with manifest.json)', async () => {
    await fs.mkdir(path.join(tmp, 'A'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'B', 'sub'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'C', 'inside-test'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'C', 'manifest.json'), '{}');

    const list = await listExistingTiTestFolders(tmp);
    expect(list).toContain('');
    expect(list).toContain('A');
    expect(list).toContain('B');
    expect(list.some((p) => p === 'B/sub' || p === path.join('B', 'sub'))).toBe(true);
    expect(list).not.toContain('C');
    expect(list.some((p) => p.startsWith('C'))).toBe(false);
  });

  it('skips dot-folders', async () => {
    await fs.mkdir(path.join(tmp, '.git'), { recursive: true });
    await fs.mkdir(path.join(tmp, 'Real'), { recursive: true });
    const list = await listExistingTiTestFolders(tmp);
    expect(list).toContain('Real');
    expect(list).not.toContain('.git');
  });

  it('returns [""] if rootFolder does not exist', async () => {
    const ghost = path.join(tmp, 'does-not-exist');
    const list = await listExistingTiTestFolders(ghost);
    expect(list).toEqual(['']);
  });
});

describe('createFolderCommand', () => {
  const win = vscode.window as any;
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tititestcmd-'));
    win.showInputBox = vi.fn();
    win.showErrorMessage = vi.fn().mockResolvedValue(undefined);
    win.showInformationMessage = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('errors if no rootFolder', async () => {
    win.showInputBox.mockResolvedValue('X');
    const refresh = vi.fn();
    const result = await createFolderCommand(undefined, undefined, refresh);
    expect(result).toBeUndefined();
    expect(win.showErrorMessage).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cancels silently if input cancelled', async () => {
    win.showInputBox.mockResolvedValue(undefined);
    const refresh = vi.fn();
    const result = await createFolderCommand(undefined, tmp, refresh);
    expect(result).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('creates folder at root and refreshes', async () => {
    win.showInputBox.mockResolvedValue('NewFolder');
    const refresh = vi.fn();
    const result = await createFolderCommand(undefined, tmp, refresh);
    expect(result).toBe(path.join(tmp, 'NewFolder'));
    expect(refresh).toHaveBeenCalled();
    const stat = await fs.stat(result!);
    expect(stat.isDirectory()).toBe(true);
  });

  it('creates subfolder under folder-kind item', async () => {
    await fs.mkdir(path.join(tmp, 'P'), { recursive: true });
    win.showInputBox.mockResolvedValue('Sub');
    const refresh = vi.fn();
    const item = { node: { kind: 'folder', relativePath: 'P' } };
    const result = await createFolderCommand(item, tmp, refresh);
    expect(result).toBe(path.join(tmp, 'P', 'Sub'));
  });

  it('passes sibling list to validateInput', async () => {
    await fs.mkdir(path.join(tmp, 'Existing'), { recursive: true });
    win.showInputBox.mockImplementation(async (opts: any) => {
      const err = opts.validateInput('Existing');
      expect(err).toBeTruthy();
      const ok = opts.validateInput('Brand_New');
      expect(ok).toBeUndefined();
      return undefined;
    });
    const refresh = vi.fn();
    await createFolderCommand(undefined, tmp, refresh);
  });
});

describe('pickFolderForCapture', () => {
  const win = vscode.window as any;
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pick-'));
    win.showQuickPick = vi.fn();
    win.showInputBox = vi.fn();
    win.showErrorMessage = vi.fn().mockResolvedValue(undefined);
    win.showInformationMessage = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('cancel returns undefined', async () => {
    win.showQuickPick.mockResolvedValue(undefined);
    const result = await pickFolderForCapture(tmp, vi.fn());
    expect(result).toBeUndefined();
  });

  it('picking root returns rootFolder', async () => {
    win.showQuickPick.mockResolvedValue({ _kind: 'folder', _rel: '' });
    const result = await pickFolderForCapture(tmp, vi.fn());
    expect(result).toBe(tmp);
  });

  it('picking existing subfolder returns absolute path', async () => {
    await fs.mkdir(path.join(tmp, 'A'), { recursive: true });
    win.showQuickPick.mockResolvedValue({ _kind: 'folder', _rel: 'A' });
    const result = await pickFolderForCapture(tmp, vi.fn());
    expect(result).toBe(path.join(tmp, 'A'));
  });

  it('picking «New» triggers createFolderCommand and returns its result', async () => {
    win.showQuickPick.mockResolvedValue({ _kind: 'new' });
    win.showInputBox.mockResolvedValue('Fresh');
    const refresh = vi.fn();
    const result = await pickFolderForCapture(tmp, refresh);
    expect(result).toBe(path.join(tmp, 'Fresh'));
    expect(refresh).toHaveBeenCalled();
  });

  it('quickpick contains «$(plus) New folder…» as first item', async () => {
    let captured: any[] = [];
    win.showQuickPick.mockImplementation(async (items: any[]) => {
      captured = items;
      return undefined;
    });
    await pickFolderForCapture(tmp, vi.fn());
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]._kind).toBe('new');
    expect(captured[0].label).toContain('New folder');
  });
});
