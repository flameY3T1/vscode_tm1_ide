import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { initServerManager, saveServers, getAllServers } from '../../serverState/state';
import { fakeContext } from './fakeCtx';
import {
  listCredentials, getCredential, saveCredential, deleteCredential,
  credentialUsers, newCredentialId,
} from '../../commands/serverManager/credentials';
import { credKey } from '../../serverState/state';
import { saveAdminServer } from '../../serverState/adminServers';
import { saveServerFromForm } from '../../commands/serverManager/form';

let ctx: vscode.ExtensionContext;

beforeEach(() => {
  ctx = fakeContext();
  initServerManager(ctx);
});

function set(over: Partial<Parameters<typeof saveCredential>[0]> = {}) {
  return { id: 'cred:1', name: 'PROD Max', username: 'max', authType: 'Basic' as const, ...over };
}

describe('credential set store', () => {
  it('creates a set and returns it', async () => {
    await saveCredential(set(), 'geheim');
    expect(listCredentials().map(c => c.name)).toEqual(['PROD Max']);
    expect(getCredential('cred:1')?.username).toBe('max');
  });

  it('puts the password in SecretStorage, never in globalState', async () => {
    await saveCredential(set(), 'geheim');
    expect(await ctx.secrets.get(credKey('cred:1'))).toBe('geheim');
    expect(JSON.stringify(ctx.globalState.get('tm1.credentials'))).not.toContain('geheim');
  });

  it('allows the same user name under two names — the name is the key', async () => {
    // maxmustermann has a different password on PROD than on TEST.
    await saveCredential(set(), 'a');
    await saveCredential(set({ id: 'cred:2', name: 'TEST Max' }), 'b');
    expect(listCredentials()).toHaveLength(2);
  });

  it('rejects a duplicate name instead of creating a second entry', async () => {
    await saveCredential(set(), 'a');
    const res = await saveCredential(set({ id: 'cred:2' }), 'b');
    expect(res.error).toBeTruthy();
    expect(listCredentials()).toHaveLength(1);
  });

  it('leaves an empty password untouched when editing', async () => {
    await saveCredential(set(), 'geheim');
    await saveCredential(set({ username: 'moritz' }), undefined);
    expect(getCredential('cred:1')?.username).toBe('moritz');
    expect(await ctx.secrets.get(credKey('cred:1'))).toBe('geheim');
  });

  it('names the profiles that use a set', async () => {
    await saveCredential(set(), 'a');
    await saveServers(ctx, [{
      id: 's1', name: 'SALES', serverUrl: 'https://h:1', username: '',
      rejectUnauthorized: false, authType: 'Basic', credentialId: 'cred:1',
    }]);
    expect(credentialUsers(ctx, 'cred:1')).toEqual(['SALES']);
  });

  it('refuses to delete a set that is in use', async () => {
    await saveCredential(set(), 'a');
    await saveServers(ctx, [{
      id: 's1', name: 'SALES', serverUrl: 'https://h:1', username: '',
      rejectUnauthorized: false, authType: 'Basic', credentialId: 'cred:1',
    }]);
    const res = await deleteCredential(ctx, 'cred:1');
    expect(res.inUseBy).toEqual(['SALES']);
    expect(listCredentials()).toHaveLength(1);
  });

  it('deletes an unused set together with its secret', async () => {
    await saveCredential(set(), 'a');
    const res = await deleteCredential(ctx, 'cred:1');
    expect(res.inUseBy).toBeUndefined();
    expect(listCredentials()).toEqual([]);
    expect(await ctx.secrets.get(credKey('cred:1'))).toBeUndefined();
  });


  // Final review 2026-08-28, finding 3: `credentialUsers` only searched
  // `getAllServers`. A set that ONLY an admin server points to via
  // `defaultCredentialId` could thus be deleted — `adminDiscovery`
  // then stamped the dead id onto every newly discovered instance, and the
  // user saw "credentials missing" on connecting without any cause.
  it('also names the admin server that holds the set as its default, and refuses deletion', async () => {
    await saveCredential(set(), 'a');
    await saveAdminServer({
      id: 'adm1', name: 'PA-Adminserver', serverUrl: 'http://h:5895',
      rejectUnauthorized: false, hidden: [], defaultCredentialId: 'cred:1',
    });

    const users = credentialUsers(ctx, 'cred:1');
    expect(users).toHaveLength(1);
    // Shown distinguishably — otherwise the user would search for the name
    // in vain in their server list.
    expect(users[0]).toContain('PA-Adminserver');
    expect(users[0]).not.toBe('PA-Adminserver');

    const res = await deleteCredential(ctx, 'cred:1');
    expect(res.inUseBy).toEqual(users);
    expect(listCredentials()).toHaveLength(1);
  });

  // Final review 2026-08-28, finding 4: a CAM set without a namespace could
  // be created and only failed on connecting — it could not be repaired
  // in the server form, because there the field is locked when a set is selected.
  it('rejects a CAM set without a namespace', async () => {
    const res = await saveCredential(set({ authType: 'CAM' }), 'a');
    expect(res.error).toBeTruthy();
    expect(listCredentials()).toEqual([]);

    const ok = await saveCredential(set({ authType: 'CAM', camNamespace: 'LDAP' }), 'a');
    expect(ok.error).toBeUndefined();
    expect(getCredential('cred:1')?.camNamespace).toBe('LDAP');
  });

  // Finding 6: `addServerPanel` passes `{ ...msg.set, id }` through from the webview,
  // and whatever lands here is stored in plain text in `globalState`. A fixed
  // field list makes the promise structural instead of conventional.
  it('writes only the known fields to globalState, no passed-through extras', async () => {
    await saveCredential(
      { ...set(), password: 'DARF-NICHT-ANKOMMEN', schmuggel: 1 } as never,
      'a',
    );
    const stored = ctx.globalState.get('tm1.credentials') as Record<string, unknown>[];
    expect(Object.keys(stored[0]).sort()).toEqual(['authType', 'id', 'name', 'username']);
    expect(JSON.stringify(stored)).not.toContain('DARF-NICHT-ANKOMMEN');
  });


  // Final review 2026-08-28, finding 7: the host accepted any `credentialId`.
  // A profile with a dead reference only reports "credentials missing"
  // on connecting, without naming the cause — and a fallback to
  // the form fields would be wrong, because with a selected set they only carry
  // the set's display values.
  it('does not save a profile with a reference to a set that does not exist', async () => {
    const res = await saveServerFromForm(ctx, {
      name: 'SALES', serverUrl: 'https://h:1', username: '', password: '',
      authType: 'Basic', rejectUnauthorized: false, credentialId: 'gibtsnicht',
    }, 's1');
    expect(res.credentialError).toBeTruthy();
    expect(res.profile).toBeUndefined();
    expect(getAllServers(ctx)).toEqual([]);
  });

  it('assigns different ids within one tick', () => {
    expect(newCredentialId()).not.toBe(newCredentialId());
  });
});
