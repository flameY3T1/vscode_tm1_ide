import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

// The process file editor in a real VS Code host: a `.ti` + `.json` pair is the
// truth, the process-editor webview a view of it. No TM1 server — the file is
// unbound, so nothing here can reach a server.

interface Probe {
  sections: { prolog: string; metadata: string; data: string; epilog: string };
  parameterNames: string[];
  cursor: { section: string; line: number; column: number };
}

const probe = (req: { action?: 'undo' | 'type'; section?: string; text?: string } = {}) =>
  vscode.commands.executeCommand<Probe | undefined>('tm1.internal.processFileTestProbe', req);

async function until(pred: (p: Probe) => boolean, ms = 10000): Promise<Probe> {
  const end = Date.now() + ms;
  let last: Probe | undefined;
  while (Date.now() < end) {
    last = await probe();
    if (last && pred(last)) { return last; }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('timeout; last probe: ' + JSON.stringify(last));
}

// An external write right after opening can land before VS Code's file watcher
// is armed and is then never reported (CI 2026-11-05). Write again until it arrives.
async function writeUntil(file: string, content: string, pred: (p: Probe) => boolean): Promise<void> {
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(file, content);
    try { await until(pred, 3000); return; } catch (e) { if (i === 3) { throw e; } }
  }
}

// The file is unbound (11.x layout): the break before #endregion belongs to the tab's code.
const ti = (prolog: string, data = '') =>
  `#region Prolog\r\n${prolog}\r\n#endregion` + (data ? `\r\n#region Data\r\n${data}\r\n#endregion` : '');
const header = (params: string[]) => JSON.stringify({
  Name: 'probe', HasSecurityAccess: false, DataSource: { Type: 'None' },
  Parameters: params.map(n => ({ Name: n, Prompt: '', Value: '', Type: 'String' })), Variables: [],
}, null, 2);

suite('process file editor', () => {
  test('external edits arrive with undo, own edits autosave, broken markers are refused', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-procfile-'));
    const tiPath = path.join(dir, 'probe.ti');
    fs.writeFileSync(tiPath, ti('a = 1;'));
    fs.writeFileSync(path.join(dir, 'probe.json'), header([]));
    const uri = vscode.Uri.file(tiPath);
    await vscode.extensions.getExtension('flameY3T1.vscode-tm1-ide')!.activate();
    await vscode.commands.executeCommand('vscode.openWith', uri, 'tm1.processFile');
    await until(p => p.sections.prolog === 'a = 1;\n');

    // 1. Another tool rewrites the prolog on disk.
    await writeUntil(tiPath, ti('a = 1;\nb = 2;'), p => p.sections.prolog === 'a = 1;\nb = 2;\n');

    // 2. Undo in the webview walks back through the external edit; the document follows.
    const undone = await probe({ section: 'prolog', action: 'undo' });
    assert.strictEqual(undone?.sections.prolog, 'a = 1;\n');
    const doc = await vscode.workspace.openTextDocument(uri);
    for (let i = 0; i < 40 && doc.getText() !== ti('a = 1;'); i++) { await new Promise(r => setTimeout(r, 100)); }
    assert.strictEqual(doc.getText(), ti('a = 1;'), 'webview undo did not reach the document');

    // 3. Another tool rewrites the header on disk: the parameter shows up.
    await writeUntil(path.join(dir, 'probe.json'), header(['pYear']), p => p.parameterNames.includes('pYear'));

    // 4. Typing in the webview is on disk after the autosave.
    await probe({ section: 'data', action: 'type', text: 'x = 3;' });
    const end = Date.now() + 5000;
    // The bytes are on disk before `save()` resolves and clears the dirty flag: wait for both.
    while (Date.now() < end && (doc.isDirty || !fs.readFileSync(tiPath, 'utf8').includes('x = 3;'))) { await new Promise(r => setTimeout(r, 150)); }
    assert.ok(fs.readFileSync(tiPath, 'utf8').includes('x = 3;'), 'typed text never reached the disk');
    assert.ok(!doc.isDirty, 'document still dirty after autosave');
    // The header is written behind the scenes: VS Code opens a tab for a file
    // changed by WorkspaceEdit that no editor shows — the user had to close it.
    await new Promise(r => setTimeout(r, 2500));
    const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
    assert.deepStrictEqual(tabs, ['probe.ti'], 'header file popped up as a tab');
    assert.ok(fs.readFileSync(path.join(dir, 'probe.json'), 'utf8').includes('pYear'), 'header lost the parameter');

    // 5. A file with a missing marker is refused: the webview keeps its state.
    const before = await probe();
    fs.writeFileSync(tiPath, ti('WIPED', 'x = 3;').replace('\r\n#endregion\r\n#region Data', '\r\n#region Data'));
    await new Promise(r => setTimeout(r, 1500));
    const after = await probe();
    assert.deepStrictEqual(after?.sections, before?.sections, 'damaged file was applied');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a code edit leaves a pulled header byte for byte as it was', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-pf-hdr-'));
    const tiPath = path.join(dir, 'pulled.ti');
    const jsonPath = path.join(dir, 'pulled.json');
    // 11.8 read shape: DataSource fields the form renames or drops, an empty
    // VariablesUIData next to a variable, an empty UIData.
    const pulled = JSON.stringify({
      Name: 'pulled', HasSecurityAccess: false, UIData: '', VariablesUIData: [],
      DataSource: { Type: 'TM1CubeView', dataSourceNameForClient: 'Sales', dataSourceNameForServer: 'Sales', view: 'All' },
      Parameters: [],
      Variables: [{ Name: 'vA', Type: 'String', Position: 1, StartByte: 0, EndByte: 0 }],
    }, null, 2) + '\n';
    fs.writeFileSync(tiPath, ti('a = 1;'));
    fs.writeFileSync(jsonPath, pulled);
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(tiPath), 'tm1.processFile');
    await until(p => p.sections.prolog === 'a = 1;\n');

    await probe({ section: 'prolog', action: 'type', text: 'b = 2;' });
    const end = Date.now() + 5000;
    while (Date.now() < end && !fs.readFileSync(tiPath, 'utf8').includes('b = 2;')) { await new Promise(r => setTimeout(r, 150)); }
    assert.ok(fs.readFileSync(tiPath, 'utf8').includes('b = 2;'), 'typed text never reached the disk');
    assert.strictEqual(fs.readFileSync(jsonPath, 'utf8'), pulled, 'header rewritten in the editor\'s shape');

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
