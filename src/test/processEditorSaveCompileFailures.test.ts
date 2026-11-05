import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

/**
 * Regression guard for the two formerly SILENT failure paths in
 * `handleMonacoSave` (src/commands/processEditor/save.ts).
 *
 * A process can only be validated by the server, so the editor deploys FIRST
 * and compiles second. That leaves two windows where the user could be told a
 * comfortable lie:
 *
 *  1. Compile reported errors, so the old version is re-deployed — but that
 *     revert itself failed. The message used to stay "Compile error — not
 *     saved", while the broken code was in fact live on the server.
 *  2. The compile call never answered at all (endpoint missing, connection
 *     dropped). The old `catch {}` fell straight into the success branch, so
 *     the user saw a clean save of something nothing had validated.
 *
 * Both are now surfaced. Case 2 still commits the save on purpose — the code
 * IS deployed and reverting would throw away a probably-good save — so the
 * test pins `true` plus the warning, not a refusal.
 */

vi.mock('../tm1Client', () => ({
  apiRequest: vi.fn(),
  deployProcess: vi.fn(),
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/processCompile', () => ({ compileProcess: vi.fn() }));
vi.mock('../commands/git/mirror', () => ({ mirrorProcessAfterSave: vi.fn() }));

import { handleMonacoSave } from '../commands/processEditor/save';
import { apiRequest, deployProcess } from '../tm1Client';
import { compileProcess } from '../tm1Rest/processCompile';
import { _sessions } from '../commands/processEditor/state';
import { testSession } from './helpers/processEditorSession';
import type { Tm1Config } from '../tm1Rest/transport/types';

const CONFIG = {
  serverUrl: 'http://tm1:8001', username: 'admin', password: 'p',
  rejectUnauthorized: false, authType: 'Basic' as const,
} as Tm1Config;

const SERVER_KEY = '__default__';
const PANEL_KEY = `${SERVER_KEY}|Sales`;

const OLD = { prolog: 'OLD_P', metadata: 'OLD_M', data: 'OLD_D', epilog: 'OLD_E' };
const NEW = { prolog: 'NEW_P', metadata: 'NEW_M', data: 'NEW_D', epilog: 'NEW_E' };

const mockDeploy = vi.mocked(deployProcess);
const mockCompile = vi.mocked(compileProcess);

function fakePanel(): any {
  return {
    title: '',
    webview: { postMessage: vi.fn(), onDidReceiveMessage: vi.fn() },
  };
}

const posted = (p: any) => p.webview.postMessage.mock.calls.map((c: any[]) => c[0]);
const errorTexts = (): string[] =>
  vi.mocked(vscode.window.showErrorMessage).mock.calls.map(c => String(c[0]));
const warningTexts = (): string[] =>
  vi.mocked(vscode.window.showWarningMessage).mock.calls.map(c => String(c[0]));

let panel: any;

beforeEach(() => {
  vi.clearAllMocks();
  // Not part of the minimal vscode mock; save() calls it on the success path.
  (vscode.window as any).setStatusBarMessage = vi.fn();

  panel = fakePanel();
  _sessions.clear();
  const session = testSession(panel, PANEL_KEY, 'Sales', SERVER_KEY, CONFIG);
  session.code = { ...OLD, parameters: [], variables: [], hasSecurity: false };
  session.dirty = true;

  mockDeploy.mockResolvedValue(undefined as never);
  mockCompile.mockResolvedValue([]);
});

function save(): Promise<boolean> {
  return handleMonacoSave(
    panel, PANEL_KEY, 'Sales', SERVER_KEY,
    NEW,
    undefined, undefined, undefined,
    CONFIG,
  );
}

const COMPILE_ERRORS = [{ Procedure: 'Prolog' as const, LineNumber: 7, Message: 'syntax' }];

describe('handleMonacoSave — compile errors, revert succeeded', () => {
  beforeEach(() => { mockCompile.mockResolvedValue(COMPILE_ERRORS); });

  it('reports "not saved" and returns false', async () => {
    expect(await save()).toBe(false);
    expect(errorTexts()).toContainEqual(expect.stringContaining('not saved'));
    expect(errorTexts().join('|')).not.toMatch(/could NOT be restored/);
  });

  it('posts the same "not saved" message to the webview', async () => {
    await save();
    const saveError = posted(panel).find((m: any) => m?.type === 'saveError');
    expect(saveError?.message).toContain('not saved');
    expect(saveError?.message).not.toMatch(/could NOT be restored/);
  });

  it('re-deploys the previous version', async () => {
    await save();
    expect(mockDeploy).toHaveBeenCalledTimes(2);
    expect(mockDeploy.mock.calls[1][1]).toEqual(OLD);
  });

  it('re-deploys the previous HasSecurityAccess flag, not the new one', async () => {
    await handleMonacoSave(panel, PANEL_KEY, 'Sales', SERVER_KEY, NEW,
      undefined, undefined, undefined, CONFIG, false, 0, true);
    expect(mockDeploy.mock.calls[0][6]).toBe(true);
    expect(mockDeploy.mock.calls[1][6]).toBe(false);
  });

  it('reads the server DataSource first when the panel never knew it, and re-deploys it', async () => {
    const stored = { Type: 'ASCII', dataSourceNameForServer: 'old.csv' };
    vi.mocked(apiRequest).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ DataSource: stored }) } as never);
    const fresh = { Type: 'ASCII', dataSourceNameForServer: 'new.csv' } as never;
    await handleMonacoSave(panel, PANEL_KEY, 'Sales', SERVER_KEY, NEW,
      undefined, fresh, undefined, CONFIG);
    expect(mockDeploy.mock.calls[0][2]).toEqual(fresh);
    expect(mockDeploy.mock.calls[1][2]).toEqual(stored);
  });

  it('does not commit the save state (panel stays dirty, stored code untouched)', async () => {
    await save();
    expect(_sessions.get(PANEL_KEY)?.dirty).toBe(true);
    expect(_sessions.get(PANEL_KEY)?.code).toMatchObject(OLD);
    expect(posted(panel).map((m: any) => m?.type)).not.toContain('saveSuccess');
  });

  it('still surfaces the compile markers', async () => {
    await save();
    const res = posted(panel).find((m: any) => m?.type === 'compileResults');
    expect(res?.errorsBySection?.prolog).toHaveLength(1);
    expect(res.errorsBySection.prolog[0]).toMatchObject({ line: 7, section: 'prolog' });
  });
});

describe('handleMonacoSave — compile errors AND the revert failed', () => {
  beforeEach(() => {
    mockCompile.mockResolvedValue(COMPILE_ERRORS);
    // 1st call = deploy of the new (broken) code, 2nd = the revert.
    mockDeploy.mockReset();
    mockDeploy
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('connection reset'));
  });

  it('says the server still holds the broken code, not "not saved"', async () => {
    expect(await save()).toBe(false);
    const msg = errorTexts().join('|');
    expect(msg).toMatch(/could NOT be restored/);
    expect(msg).toMatch(/still holds the broken code/);
  });

  it('posts that same message to the webview as saveError', async () => {
    await save();
    const saveError = posted(panel).find((m: any) => m?.type === 'saveError');
    expect(saveError?.message).toMatch(/could NOT be restored/);
  });

  it('a failed revert is not swallowed into a rejected save() call', async () => {
    await expect(save()).resolves.toBe(false);
    // The generic "Deploy failed" catch must NOT be the one that ran.
    expect(errorTexts().join('|')).not.toMatch(/Deploy failed/);
  });

  it('does not commit the save state', async () => {
    await save();
    expect(_sessions.get(PANEL_KEY)?.dirty).toBe(true);
    expect(_sessions.get(PANEL_KEY)?.code).toMatchObject(OLD);
  });
});

describe('handleMonacoSave — compile API unreachable', () => {
  beforeEach(() => { mockCompile.mockRejectedValue(new Error('HTTP 404 tm1.Compile')); });

  it('warns that the process is on the server unvalidated', async () => {
    await save();
    const msg = warningTexts().join('|');
    expect(msg).toMatch(/compile check could not run/);
    expect(msg).toMatch(/HTTP 404 tm1\.Compile/);
    expect(msg).toMatch(/unvalidated/);
  });

  it('still commits the save (the code IS deployed) and returns true', async () => {
    expect(await save()).toBe(true);
    expect(_sessions.get(PANEL_KEY)?.dirty).toBe(false);
    expect(_sessions.get(PANEL_KEY)?.code).toMatchObject(NEW);
    expect(posted(panel).map((m: any) => m?.type)).toContain('saveSuccess');
  });

  it('does not attempt a revert', async () => {
    await save();
    expect(mockDeploy).toHaveBeenCalledTimes(1);
  });

  it('shows no compile-error toast', async () => {
    await save();
    expect(errorTexts()).toEqual([]);
  });
});

describe('handleMonacoSave — clean compile', () => {
  it('returns true, commits, and warns about nothing', async () => {
    expect(await save()).toBe(true);
    expect(warningTexts()).toEqual([]);
    expect(errorTexts()).toEqual([]);
    expect(_sessions.get(PANEL_KEY)?.dirty).toBe(false);
    expect(_sessions.get(PANEL_KEY)?.code).toMatchObject(NEW);
    expect(posted(panel).map((m: any) => m?.type)).toContain('saveSuccess');
  });
});
