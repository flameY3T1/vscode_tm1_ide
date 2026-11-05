import * as vscode from 'vscode';
import type { ProcessParameter, Tm1Config } from '../../tm1Rest/transport/types';
import {
  _debugSessions, _sessions, configureProcessEditor, type PanelSession,
  getActivePanel as stateGetActivePanel, sessionsOfProcess,
} from './state';
import { getActivePanelParameters, openProcess } from './openPanel';
import { broadcastSnippets, broadcastV12Mode, disposeAll, disposePanel, disposePanelsForServer, onPanelDisposed } from './lifecycle';
import { cleanupDebugSession } from './debug';

/**
 * Manages open Process Editor WebviewPanels.
 * Ensures singleton behavior (one panel per process name) and handles lifecycle.
 *
 * State and handlers live in sibling modules — this class is a thin facade
 * preserving the original constructor signature so call sites in extension.ts
 * stay unchanged. The whole `commands/processEditor/` directory is treated
 * as one logical singleton.
 */
export class ProcessEditorManager {
  constructor(
    getSnippets: (activeServer: string | undefined) => Array<{ id: string; trigger: string; name: string; description: string; body: string }> = () => [],
    getActiveServer: () => string | undefined = () => undefined,
    extensionUri?: vscode.Uri,
    getServerName: (serverUrl: string) => string | undefined = () => undefined,
    context?: vscode.ExtensionContext,
  ) {
    configureProcessEditor({ getSnippets, getActiveServer, extensionUri, getServerName, context });
  }

  /** Returns the most recently focused Process Editor panel, or null if none open. */
  getActivePanel(): vscode.WebviewPanel | null {
    return stateGetActivePanel();
  }

  /** Roundtrips the active panel for its current parameter list. Times out at 2 s with []. */
  async getActivePanelParameters(): Promise<ProcessParameter[]> {
    return getActivePanelParameters();
  }

  /** @returns `true` when the editor is open afterwards — see `openPanel.openProcess`. */
  async openProcess(processName: string, node: any, config: Tm1Config, reveal?: { section: string; line: number }): Promise<boolean> {
    return openProcess(processName, node, config, reveal);
  }

  async cleanupDebugSession(panelKey: string): Promise<void> {
    return cleanupDebugSession(panelKey);
  }

  broadcastV12Mode(): void {
    broadcastV12Mode();
  }

  /** Call after every change to the snippets — open panels catch up. */
  broadcastSnippets(): void {
    broadcastSnippets();
  }

  async disposeAll(): Promise<boolean> {
    return disposeAll();
  }

  disposePanelsForServer(serverUrl: string): void {
    disposePanelsForServer(serverUrl);
  }

  /** Close the open editor panel for a single process (no-op if none open). */
  disposePanel(processName: string, serverUrl?: string): void {
    disposePanel(processName, serverUrl);
  }

  /**
   * Async since the draft-recovery work: a dirty panel's content is parked
   * before the registry entry is dropped. The promise is propagated rather than
   * voided so a caller that wants to know the draft landed can await it.
   */
  onPanelDisposed(session: PanelSession): Promise<void> {
    return onPanelDisposed(session);
  }

  get panelCount(): number {
    return _sessions.size;
  }

  hasPanel(processName: string, serverUrl?: string): boolean {
    return sessionsOfProcess(serverUrl ?? '__default__', processName).length > 0;
  }

  isDirty(processName: string, serverUrl?: string): boolean {
    return sessionsOfProcess(serverUrl ?? '__default__', processName).some(s => s.dirty);
  }

  hasDebugSession(processName: string, serverUrl?: string): boolean {
    return sessionsOfProcess(serverUrl ?? '__default__', processName).some(s => _debugSessions.has(s.key));
  }
}
