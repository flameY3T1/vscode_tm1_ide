import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { broadcastV12Mode, postV12Mode } from '../../commands/processEditor/lifecycle';
import { _sessions } from '../../commands/processEditor/state';
import { testSession } from '../helpers/processEditorSession';
import type { Tm1Config } from '../../tm1Rest/transport/types';

/**
 * V12 mode belongs to the server a panel was opened from. Broadcasting one state to every
 * panel would put an 11.x process editor into V12 mode as soon as any v12 server is connected.
 */
const v11 = { serverUrl: 'http://eleven', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;
const v12 = { serverUrl: 'http://twelve', username: 'u', password: '', authType: 'Basic', version: 'v12' } as unknown as Tm1Config;

function fakePanel(name: string) {
  const posted: Array<Record<string, unknown>> = [];
  const panel = { webview: { postMessage: (m: Record<string, unknown>) => { posted.push(m); return true; } } };
  return { name, panel: panel as unknown as vscode.WebviewPanel, posted };
}

describe('broadcastV12Mode', () => {
  beforeEach(() => {
    _sessions.clear();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, dflt?: unknown) => (key === 'v12Mode' ? false : dflt),
    } as unknown as vscode.WorkspaceConfiguration);
  });
  afterEach(() => { _sessions.clear(); vi.restoreAllMocks(); });

  it('gives each panel the mode of its own server', () => {
    const a = fakePanel('eleven');
    const b = fakePanel('twelve');
    testSession(a.panel, 'http://eleven|P1', 'P1', 'http://eleven', v11);
    testSession(b.panel, 'http://twelve|P2', 'P2', 'http://twelve', v12);

    broadcastV12Mode();

    expect(a.posted[0].v12Mode).toBe(false);
    expect(b.posted[0].v12Mode).toBe(true);
  });

  it('falls back to the setting for a panel whose server reports no version', () => {
    // Every session carries a config now, so the old "panel without meta" case
    // is a config without `version`: the setting alone decides.
    const a = fakePanel('orphan');
    const unknownVersion = { serverUrl: 'x', username: 'u', password: '', authType: 'Basic' } as unknown as Tm1Config;
    testSession(a.panel, 'x|P', 'P', 'x', unknownVersion);
    broadcastV12Mode();
    expect(a.posted[0].v12Mode).toBe(false);
  });
});

/**
 * The broadcast only runs on a CHANGE. A freshly opened panel never experiences one —
 * so it receives its state individually as soon as its Monaco reports ready. Without that,
 * completion in the process editor stayed permanently without v12 knowledge (the reason
 * why it offered v12 functions on 11.x).
 */
describe('postV12Mode', () => {
  beforeEach(() => {
    _sessions.clear();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: (key: string, dflt?: unknown) => (key === 'v12Mode' ? false : dflt),
    } as unknown as vscode.WorkspaceConfiguration);
  });
  afterEach(() => { _sessions.clear(); vi.restoreAllMocks(); });

  it('sends a single panel the mode of its own server', () => {
    const b = fakePanel('twelve');
    testSession(b.panel, 'http://twelve|P2', 'P2', 'http://twelve', v12);

    postV12Mode(b.panel);

    expect(b.posted).toHaveLength(1);
    expect(b.posted[0].type).toBe('v12ModeChanged');
    expect(b.posted[0].v12Mode).toBe(true);
  });

  it('leaves the other panels alone', () => {
    const a = fakePanel('eleven');
    const b = fakePanel('twelve');
    testSession(a.panel, 'http://eleven|P1', 'P1', 'http://eleven', v11);
    testSession(b.panel, 'http://twelve|P2', 'P2', 'http://twelve', v12);

    postV12Mode(a.panel);

    expect(a.posted).toHaveLength(1);
    expect(b.posted).toHaveLength(0);
  });
});
