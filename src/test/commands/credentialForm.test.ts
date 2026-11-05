import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { initServerManager, getAllServers } from '../../serverState/state';
import { fakeContext } from './fakeCtx';
import { saveServerFromForm, getServerFormData } from '../../commands/serverManager/form';
import { saveCredential } from '../../commands/serverManager/credentials';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

let ctx: vscode.ExtensionContext;
beforeEach(async () => {
  ctx = fakeContext();
  initServerManager(ctx);
  await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, 'pw');
});

const form = (over = {}) => ({
  name: 'SALES', serverUrl: 'https://h:1', username: '', password: '',
  authType: 'Basic' as const, rejectUnauthorized: false, ...over,
});

describe('credential set in the server form', () => {
  it('writes the reference into the profile', async () => {
    await saveServerFromForm(ctx, form({ credentialId: 'cred:1' }), 's1');
    expect(getAllServers(ctx)[0].credentialId).toBe('cred:1');
  });

  it('returns the reference on load', async () => {
    await saveServerFromForm(ctx, form({ credentialId: 'cred:1' }), 's1');
    expect((await getServerFormData(ctx, 's1'))?.credentialId).toBe('cred:1');
  });

  it('removes the reference when "own" is selected again', async () => {
    await saveServerFromForm(ctx, form({ credentialId: 'cred:1' }), 's1');
    await saveServerFromForm(ctx, form({ username: 'eigen', password: 'p' }), 's1');
    expect(getAllServers(ctx)[0].credentialId).toBeUndefined();
    expect(getAllServers(ctx)[0].username).toBe('eigen');
  });

  it('does not store an own password when a set is selected', async () => {
    // Otherwise the same secret would be stored twice and a later
    // removal of the reference would bring back an outdated password.
    await saveServerFromForm(ctx, form({ credentialId: 'cred:1', password: 'sollte-nicht' }), 's1');
    expect(await ctx.secrets.get('tm1.pw.s1')).toBe('');
  });
});
