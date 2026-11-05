import * as assert from 'node:assert';
import * as vscode from 'vscode';

// Smoke tests against a real VS Code host. These verify the contract that the
// mocked unit tests cannot: the extension actually activates, every contributed
// command is registered, and the declared languages/configuration exist. No TM1
// server is required — activation is lazy and degrades gracefully offline.

const EXTENSION_ID = 'flameY3T1.vscode-tm1-ide';

suite('Extension smoke', () => {
  test('extension is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, 'extension did not activate');
  });

  test('all contributed commands are registered', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext!.activate();

    const contributed: string[] = (ext!.packageJSON.contributes?.commands ?? [])
      .map((c: { command: string }) => c.command);
    assert.ok(contributed.length > 0, 'no contributed commands found in package.json');

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter(c => !registered.has(c));
    assert.deepStrictEqual(missing, [], `commands declared but not registered: ${missing.join(', ')}`);
  });

  test('declared languages are registered', async () => {
    const languages = await vscode.languages.getLanguages();
    for (const id of ['ti', 'tm1rules']) {
      assert.ok(languages.includes(id), `language "${id}" not registered`);
    }
  });

  test('tm1 configuration is contributed', () => {
    const cfg = vscode.workspace.getConfiguration('tm1');
    // `timeoutMs` is a core declared setting; has() is true only for known keys.
    // (Server-level keys like serverUrl live in server profiles, not settings.)
    assert.ok(cfg.has('timeoutMs'), 'tm1.timeoutMs configuration missing');
  });
});
