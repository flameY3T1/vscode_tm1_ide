import type * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { _sessions, newPanelSession, type PanelSession } from '../../commands/processEditor/state';

const DEFAULT_CONFIG = { serverUrl: 'http://tm1:8001', username: 'admin', password: 'p', authType: 'Basic' } as Tm1Config;

/**
 * The registered process-editor session for `panel` under `key`, created on
 * first use. Tests use arbitrary keys (not always `serverKey|processName`), so
 * the key is set explicitly.
 */
export function testSession(
  panel: vscode.WebviewPanel,
  key: string,
  processName = 'Proc',
  serverKey = 'srv',
  config: Tm1Config = DEFAULT_CONFIG,
): PanelSession {
  const existing = _sessions.get(key);
  if (existing && existing.panel === panel) { return existing; }
  const s: PanelSession = { ...newPanelSession(panel, processName, serverKey, config), key };
  _sessions.set(key, s);
  return s;
}
