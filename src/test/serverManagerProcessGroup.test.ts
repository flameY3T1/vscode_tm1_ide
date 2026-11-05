import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as sm from '../commands/serverManager';

function makeCtx(servers: { id: string; name: string }[] = []) {
  const store = new Map<string, unknown>();
  if (servers.length > 0) { store.set('tm1.servers', servers); }
  return {
    _store: store,
    globalState: {
      get: (k: string, d?: unknown) => (store.has(k) ? store.get(k) : d),
      update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
    },
  } as any;
}

/** One settings key as the user has it — per scope, exactly like `inspect` reports it. */
type Scopes = { global?: string; workspace?: string; workspaceFolder?: string };

/**
 * Stub `vscode.workspace.getConfiguration('tm1')` on top of a plain per-scope map.
 *
 * `inspect` mirrors the real shape, `update(key, undefined, target)` deletes from
 * exactly that scope — so a test can assert what the migration cleared. `get`
 * stays undefined-returning: the migration must not rely on it for the removed
 * settings (a removed key has no declared default, so `get` cannot tell "user set
 * it" from "unset").
 */
function stubTm1Config(settings: Record<string, Scopes> = {}) {
  const cfg = {
    get: () => undefined,
    inspect: (key: string) => ({
      key: `tm1.${key}`,
      globalValue: settings[key]?.global,
      workspaceValue: settings[key]?.workspace,
      workspaceFolderValue: settings[key]?.workspaceFolder,
    }),
    update: (key: string, value: unknown, target: vscode.ConfigurationTarget) => {
      const scope = settings[key];
      if (scope && value === undefined) {
        if (target === vscode.ConfigurationTarget.WorkspaceFolder) { delete scope.workspaceFolder; }
        if (target === vscode.ConfigurationTarget.Workspace) { delete scope.workspace; }
        if (target === vscode.ConfigurationTarget.Global) { delete scope.global; }
      }
      return Promise.resolve();
    },
  };
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(cfg as any);
  return settings;
}

beforeEach(() => {
  // Default: nothing set anywhere. Individual tests re-stub with legacy values.
  stubTm1Config();
});

describe('process-group per-server overrides (globalState, keyed by server id)', () => {
  it('defaults to empty maps', () => {
    sm.initServerManager(makeCtx());
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: {}, mode: {} });
  });

  it('sets an override for one server, keyed by id', async () => {
    sm.initServerManager(makeCtx([{ id: 'srv-1', name: 'Prod' }]));
    await sm.setProcessGroupOverride('srv-1', '#####', 'suffix');
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: { 'srv-1': '#####' }, mode: { 'srv-1': 'suffix' } });
  });

  it('keeps multiple servers and clears just one', async () => {
    sm.initServerManager(makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Dev' }]));
    await sm.setProcessGroupOverride('srv-1', '#####', 'suffix');
    await sm.setProcessGroupOverride('srv-2', '_GRP', 'prefix');
    await sm.clearProcessGroupOverride('srv-1');
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: { 'srv-2': '_GRP' }, mode: { 'srv-2': 'prefix' } });
  });

  it('an override survives renaming the server (id stays stable)', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    sm.initServerManager(ctx);
    await sm.setProcessGroupOverride('srv-1', '_GRP', 'prefix');
    // Rename: same id, new name — exactly what serverManager/form.ts writes back.
    ctx._store.set('tm1.servers', [{ id: 'srv-1', name: 'Produktion' }]);
    expect(sm.getProcessGroupOverrides().suffix['srv-1']).toBe('_GRP');
  });

  it('migrateProcessGroupSettings sets all migration flags when there is no legacy config', async () => {
    const ctx = makeCtx();
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(ctx._store.get('tm1.processGroup.migrated')).toBe(true);
    expect(ctx._store.get('tm1.processGroup.migratedToId')).toBe(true);
    expect(ctx._store.get('tm1.processGroup.globalMigrated')).toBe(true);
  });

  it('migration is a no-op on the second run', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    sm.initServerManager(ctx);
    await sm.setProcessGroupOverride('srv-1', '#####', 'suffix');
    await sm.migrateProcessGroupSettings();
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides().suffix).toEqual({ 'srv-1': '#####' });
  });
});

describe('process-group name→id migration', () => {
  it('remaps name-keyed entries onto the matching profile ids', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Dev' }]);
    ctx._store.set('tm1.processGroupSuffixByServer', { Prod: '#####', Dev: '_GRP' });
    ctx._store.set('tm1.processGroupModeByServer', { Prod: 'suffix', Dev: 'prefix' });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '#####', 'srv-2': '_GRP' },
      mode: { 'srv-1': 'suffix', 'srv-2': 'prefix' },
    });
  });

  it('drops entries whose name matches no profile', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    ctx._store.set('tm1.processGroupSuffixByServer', { Prod: '#####', Ghost: '@@@' });
    ctx._store.set('tm1.processGroupModeByServer', { Ghost: 'prefix' });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: { 'srv-1': '#####' }, mode: {} });
  });

  it('first match wins on duplicate server names', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Prod' }]);
    ctx._store.set('tm1.processGroupSuffixByServer', { Prod: '#####' });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides().suffix).toEqual({ 'srv-1': '#####' });
  });

  it('leaves already-id-keyed entries alone', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    ctx._store.set('tm1.processGroupSuffixByServer', { 'srv-1': '#####' });
    ctx._store.set('tm1.processGroupModeByServer', { 'srv-1': 'suffix' });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: { 'srv-1': '#####' }, mode: { 'srv-1': 'suffix' } });
  });

  it('does not run twice', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    ctx._store.set('tm1.processGroupSuffixByServer', { Prod: '#####' });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    // A profile added later must not inherit anything from a second pass.
    await sm.setProcessGroupOverride('srv-1', '@@@', 'prefix');
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides().suffix).toEqual({ 'srv-1': '@@@' });
  });
});

// The global settings tm1.processGroup{Suffix,Mode} were removed from the manifest.
// A user who had them set must keep their tree, and settings.json must not keep an
// orphan entry — so the values are folded onto the override-less servers once.
describe('process-group global-setting migration', () => {
  it('does nothing but set the flag when the settings were never set', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    stubTm1Config();
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: {}, mode: {} });
    expect(ctx._store.get('tm1.processGroup.globalMigrated')).toBe(true);
  });

  it('writes the legacy token+mode onto every server without an override', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Dev' }]);
    stubTm1Config({
      processGroupSuffix: { global: '_GRP' },
      processGroupMode: { global: 'prefix' },
    });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '_GRP', 'srv-2': '_GRP' },
      mode: { 'srv-1': 'prefix', 'srv-2': 'prefix' },
    });
  });

  it('leaves a server that already has an override untouched', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Dev' }]);
    stubTm1Config({ processGroupSuffix: { global: '_GRP' }, processGroupMode: { global: 'prefix' } });
    sm.initServerManager(ctx);
    await sm.setProcessGroupOverride('srv-1', '@@@', 'suffix');
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '@@@', 'srv-2': '_GRP' },
      mode: { 'srv-1': 'suffix', 'srv-2': 'prefix' },
    });
  });

  it('fills the missing half of a half-set pair from the constants', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    stubTm1Config({ processGroupMode: { global: 'prefix' } });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '#####' },
      mode: { 'srv-1': 'prefix' },
    });
  });

  it('an explicitly empty token (= grouping off) survives as an empty override', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    stubTm1Config({ processGroupSuffix: { global: '' } });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '' },
      mode: { 'srv-1': 'suffix' },
    });
  });

  it('the most specific scope supplies the value', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    stubTm1Config({ processGroupSuffix: { global: '_GLOBAL', workspace: '_WS', workspaceFolder: '_WSF' } });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides().suffix).toEqual({ 'srv-1': '_WSF' });
  });

  it('clears the legacy settings in every scope they were set in', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    const settings = stubTm1Config({
      processGroupSuffix: { global: '_GRP', workspace: '_WS' },
      processGroupMode: { global: 'prefix' },
    });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(settings).toEqual({ processGroupSuffix: {}, processGroupMode: {} });
  });

  it('runs once — re-setting the settings afterwards has no effect', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }]);
    stubTm1Config();
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    // Second pass with legacy values present: the flag already blocks it.
    stubTm1Config({ processGroupSuffix: { global: '_GRP' } });
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({ suffix: {}, mode: {} });
  });

  it('runs after the name→id phase, so it sees the freshly re-keyed overrides', async () => {
    const ctx = makeCtx([{ id: 'srv-1', name: 'Prod' }, { id: 'srv-2', name: 'Dev' }]);
    // Legacy name-keyed override for Prod only + a legacy global for everyone else.
    ctx._store.set('tm1.processGroupSuffixByServer', { Prod: '@@@' });
    ctx._store.set('tm1.processGroupModeByServer', { Prod: 'suffix' });
    stubTm1Config({ processGroupSuffix: { global: '_GRP' }, processGroupMode: { global: 'prefix' } });
    sm.initServerManager(ctx);
    await sm.migrateProcessGroupSettings();
    expect(sm.getProcessGroupOverrides()).toEqual({
      suffix: { 'srv-1': '@@@', 'srv-2': '_GRP' },
      mode: { 'srv-1': 'suffix', 'srv-2': 'prefix' },
    });
  });
});
