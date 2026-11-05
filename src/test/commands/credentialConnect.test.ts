// src/test/commands/credentialConnect.test.ts
//
// `loadCredentials` is the ONLY way in which a connection gets
// credentials: profile OR credential set, never mixed, decided by
// the pure function `resolveCredentials` (Task 2). These tests cover
// `loadCredentials` itself (no network access — only SecretStorage +
// globalState) as well as the extended `needsInitialCredentials`.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { initServerManager, saveServers } from '../../serverState/state';
import { fakeContext } from './fakeCtx';
import { saveCredential } from '../../commands/serverManager/credentials';
import { loadCredentials, needsInitialCredentials } from '../../commands/serverManager/connection';
import { pwKey, credKey } from '../../serverState/state';
import type { ServerProfile } from '../../serverState/state';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

let ctx: vscode.ExtensionContext;
beforeEach(() => { ctx = fakeContext(); initServerManager(ctx); });

const profile = (over: Partial<ServerProfile> = {}): ServerProfile => ({
  id: 's1', name: 'SALES', serverUrl: 'https://h:1', username: 'eigen',
  rejectUnauthorized: false, authType: 'Basic' as const, ...over,
});

describe('loadCredentials', () => {
  it('reads its own profile fields when no credentialId is set', async () => {
    await saveServers(ctx, [profile()]);
    await ctx.secrets.store(pwKey('s1'), 'eigenPw');

    expect(await loadCredentials(ctx, profile())).toEqual({
      ok: true, username: 'eigen', password: 'eigenPw', authType: 'Basic', camNamespace: undefined,
    });
  });

  it('reads user and password from the credential set when credentialId is set', async () => {
    await saveCredential(
      { id: 'cred1', name: 'Satz A', username: 'satzUser', authType: 'CAM', camNamespace: 'ns' },
      'satzPw',
    );
    // The profile's own password must not leak through — the set wins completely.
    await ctx.secrets.store(pwKey('s1'), 'eigenPw');

    const p = profile({ credentialId: 'cred1' });
    expect(await loadCredentials(ctx, p)).toEqual({
      ok: true, username: 'satzUser', password: 'satzPw', authType: 'CAM', camNamespace: 'ns',
    });
  });

  it('reports a deleted set instead of silently taking the profile', async () => {
    expect(await loadCredentials(ctx, profile({ credentialId: 'weg' }))).toEqual({
      ok: false, missingCredentialId: 'weg',
    });
  });

  it('reads the set secret via credKey, not via pwKey', async () => {
    await saveCredential(
      { id: 'cred2', name: 'Satz B', username: 'satzUser2', authType: 'Basic' },
      undefined,
    );
    await ctx.secrets.store(credKey('cred2'), 'direktGesetzt');

    const p = profile({ credentialId: 'cred2' });
    expect(await loadCredentials(ctx, p)).toEqual({
      ok: true, username: 'satzUser2', password: 'direktGesetzt', authType: 'Basic', camNamespace: undefined,
    });
  });
});

describe('needsInitialCredentials with credentialId', () => {
  it('treats a discovered profile WITH a reference as provided for', () => {
    // Otherwise the server form would pop open on every connect even though everything is there.
    expect(needsInitialCredentials(
      profile({ username: '', parentAdminId: 'a1', credentialId: 'cred:1' }), undefined,
    )).toBe(false);
  });

  it('still treats a discovered profile WITHOUT anything as not provided for', () => {
    expect(needsInitialCredentials(
      profile({ username: '', parentAdminId: 'a1' }), undefined,
    )).toBe(true);
  });
});
