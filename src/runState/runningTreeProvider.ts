import * as vscode from 'vscode';
import { listRuns, onDidChangeRuns } from './runRegistry';

/** `m:ss` for short runs, `h:mm:ss` once it passes an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Status bar indicator for in-flight executions.
 *
 * The list itself lives at the top of the "Recent" view (see
 * `recentTreeProvider.ts`) — running executions deliberately do NOT get a view
 * of their own, which would push everything else down the sidebar. But the
 * sidebar is only visible while the TM1 explorer container is open, so this
 * item carries the one thing the old progress notification did right: being
 * visible from anywhere.
 */
export function createRunStatusBarItem(): vscode.Disposable {
  // 98: left of the v12 (99) and sandbox (100) indicators.
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  item.command = 'tm1.running.focus';
  const update = (): void => {
    const runs = listRuns();
    if (runs.length === 0) { item.hide(); return; }
    item.text = runs.length === 1
      ? `$(loading~spin) ${runs[0].objectName}`
      : `$(loading~spin) ${vscode.l10n.t('{0} TM1 runs', String(runs.length))}`;
    item.tooltip = runs.map(r => r.label).join('\n');
    item.show();
  };
  const sub = onDidChangeRuns(update);
  update();
  return vscode.Disposable.from(item, sub);
}
