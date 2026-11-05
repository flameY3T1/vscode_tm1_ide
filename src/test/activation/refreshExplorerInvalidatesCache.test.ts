import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';

// Spy the fetchNames cache invalidation — the refresh command must clear it so
// the TI linter picks up server-side additions (e.g. a freshly installed
// Bedrock library) instead of reporting them as "process does not exist".
vi.mock('../../providers/fetchNames', () => ({
  invalidateCache: vi.fn(),
}));

import { invalidateCache } from '../../providers/fetchNames';
import { registerTreeCommands } from '../../activation/registerTreeCommands';

function makeCtx() {
  const treeDataProvider = { refresh: vi.fn(), refreshNode: vi.fn() };
  const tiDiagnostics = { refreshAll: vi.fn() };
  return {
    ctx: {
      context: { subscriptions: [] as unknown[] },
      treeDataProvider,
      processEditorManager: {},
      cubeStatsDashboardManager: {},
      tiDiagnostics,
    } as never,
    treeDataProvider,
    tiDiagnostics,
  };
}

function handlerFor(id: string): (...args: unknown[]) => unknown {
  const reg = vscode.commands.registerCommand as unknown as { mock: { calls: unknown[][] } };
  const call = reg.mock.calls.find(c => c[0] === id);
  if (!call) { throw new Error(`command ${id} not registered`); }
  return call[1] as (...args: unknown[]) => unknown;
}

describe('tm1.refreshExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the fetchNames cache, re-lints open docs, then refreshes the tree', () => {
    const { ctx, treeDataProvider, tiDiagnostics } = makeCtx();
    registerTreeCommands(ctx);

    handlerFor('tm1.refreshExplorer')();

    expect(invalidateCache).toHaveBeenCalledTimes(1);
    expect(tiDiagnostics.refreshAll).toHaveBeenCalledTimes(1);
    expect(treeDataProvider.refresh).toHaveBeenCalledTimes(1);
  });
});
