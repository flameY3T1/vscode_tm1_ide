import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { initServerManager, getAllServers } from '../../serverState/state';
import { fakeContext } from './fakeCtx';
import { handleCredMessage, resolveFormCredentials } from '../../commands/serverConfig/addServerPanel';
import { saveCredential, listCredentials } from '../../commands/serverManager/credentials';
import { saveServerFromForm } from '../../commands/serverManager/form';

vi.mock('vscode', async () => await import('../__mocks__/vscode'));

// The most important promise of this task: a set password must never leave
// the panel. The message branches in addServerPanel.ts (credList/credSave/
// credDelete) were untested for this so far — this test closes exactly
// that gap, see fix round 1 for task 4.
const GEHEIM = 'g3h31m-passwort-das-nie-rausdarf';

let ctx: vscode.ExtensionContext;
beforeEach(() => {
  ctx = fakeContext();
  initServerManager(ctx);
});

describe('credential set messages in the panel', () => {
  describe('credList', () => {
    it('answers with one entry per set, hasPassword depending on the stored secret', async () => {
      await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, GEHEIM);
      await saveCredential({ id: 'cred:2', name: 'DEV', username: 'eva', authType: 'Basic' }, undefined);

      const result = await handleCredMessage(ctx, { type: 'credList' });
      expect(result.type).toBe('credListResult');
      if (result.type !== 'credListResult') { throw new Error('unreachable'); }
      expect(result.sets).toHaveLength(2);

      const prod = result.sets.find(s => s.id === 'cred:1');
      const dev = result.sets.find(s => s.id === 'cred:2');
      expect(prod?.hasPassword).toBe(true);
      expect(dev?.hasPassword).toBe(false);
    });

    it('the sent object contains the plain-text password nowhere', async () => {
      // A field-by-field check is not enough — it does not hold when a field
      // is added later. JSON.stringify checks the WHOLE sent object.
      await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, GEHEIM);

      const result = await handleCredMessage(ctx, { type: 'credList' });
      expect(JSON.stringify(result)).not.toContain(GEHEIM);
    });
  });

  describe('credSave', () => {
    it('assigns a new id for an empty id and answers ok: true', async () => {
      const result = await handleCredMessage(ctx, {
        type: 'credSave',
        set: { id: '', name: 'NEU', username: 'max', authType: 'Basic' },
        password: 'pw',
      });
      expect(result.type).toBe('credSaveResult');
      if (result.type !== 'credSaveResult') { throw new Error('unreachable'); }
      expect(result.ok).toBe(true);
      expect(result.id).toBeTruthy();
      expect(listCredentials()).toHaveLength(1);
    });

    it('a duplicate name answers ok: false with a message, no second set is created', async () => {
      await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, 'pw');

      const result = await handleCredMessage(ctx, {
        type: 'credSave',
        set: { id: '', name: 'PROD', username: 'anderer', authType: 'Basic' },
        password: 'pw2',
      });
      expect(result.type).toBe('credSaveResult');
      if (result.type !== 'credSaveResult') { throw new Error('unreachable'); }
      expect(result.ok).toBe(false);
      expect(result.message).toBeTruthy();
      expect(listCredentials()).toHaveLength(1);
    });

    it('password: "" leaves an existing secret in place (panel passes undefined on)', async () => {
      await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, GEHEIM);

      await handleCredMessage(ctx, {
        type: 'credSave',
        set: { id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' },
        password: '',
      });

      expect(await ctx.secrets.get('tm1.cred.cred:1')).toBe(GEHEIM);
    });
  });

  describe('credDelete', () => {
    it('a set in use answers ok: false and names the profiles in inUseBy, the set remains', async () => {
      await saveCredential({ id: 'cred:1', name: 'PROD', username: 'max', authType: 'Basic' }, 'pw');
      await saveServerFromForm(ctx, {
        name: 'SALES', serverUrl: 'https://h:1', username: '', password: '',
        authType: 'Basic', rejectUnauthorized: false, credentialId: 'cred:1',
      }, 's1');

      const result = await handleCredMessage(ctx, { type: 'credDelete', id: 'cred:1' });
      expect(result.type).toBe('credDeleteResult');
      if (result.type !== 'credDeleteResult') { throw new Error('unreachable'); }
      expect(result.ok).toBe(false);
      expect(result.inUseBy).toEqual(['SALES']);
      expect(getAllServers(ctx).some(s => s.id === 's1')).toBe(true);
      expect(listCredentials()).toHaveLength(1);
    });
  });
});

// Final review 2026-08-28, finding 2: the dots placeholder from the
// locked password field went all the way through to `testServerConnection` —
// `cfgFromForm` does not consider `credentialId` at all and took `data.password`
// literally. Consequence: the connection test logged in to the real server with the
// REAL user name of the set and eight dots (account lockout
// with a group account), and because "Save" for an instance depends on a
// successful test, an instance profile with a credential set could not be
// saved at all. It is now resolved host-side, BEFORE the test.
describe('resolveFormCredentials — resolve the credential set before the connection test', () => {
  const FORM = {
    name: 'SALES', serverUrl: 'https://h:1',
    username: 'satzUser', password: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
    authType: 'Basic' as const, rejectUnauthorized: false,
  };

  it('without a reference the form data stays unchanged', async () => {
    const eigene = { ...FORM, username: 'eigen', password: 'eigenesPw' };
    const res = await resolveFormCredentials(ctx, eigene);
    expect(res.ok).toBe(true);
    if (!res.ok) { throw new Error('unreachable'); }
    expect(res.data).toEqual(eigene);
  });

  it('with a reference, user, password, auth type and namespace come from the set', async () => {
    await saveCredential(
      { id: 'cred:1', name: 'PROD', username: 'max', authType: 'CAM', camNamespace: 'LDAP' },
      GEHEIM,
    );

    const res = await resolveFormCredentials(ctx, { ...FORM, credentialId: 'cred:1' });
    expect(res.ok).toBe(true);
    if (!res.ok) { throw new Error('unreachable'); }
    expect(res.data.username).toBe('max');
    expect(res.data.password).toBe(GEHEIM);
    expect(res.data.authType).toBe('CAM');
    expect(res.data.camNamespace).toBe('LDAP');
    // The display placeholder must no longer appear anywhere in the result.
    expect(JSON.stringify(res.data)).not.toContain('\u2022');
  });

  it('a deleted set reports an error and does NOT fall back to the form fields', async () => {
    const res = await resolveFormCredentials(ctx, { ...FORM, credentialId: 'weg' });
    expect(res.ok).toBe(false);
    if (res.ok) { throw new Error('unreachable'); }
    expect(res.message).toBeTruthy();
  });
});
