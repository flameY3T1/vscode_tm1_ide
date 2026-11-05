import * as vscode from 'vscode';
import { namedStore } from '../serverState/namedStore';
import { matchesServerScope } from '../utils/serverScopePure';

export interface TiSnippet {
  id: string;
  trigger: string;
  name: string;
  description: string;
  body: string;
  /** Semicolon-separated list of TM1 server names. Empty/undefined = always shown. */
  servers?: string;
}

const STORAGE_KEY = 'tm1.snippets';

/**
 * Built on the `serverManager/namedStore` blueprint — the same family as the
 * process templates next door (`processTemplates/processTemplateStorage.ts`), the
 * server profiles and the login sets: a list of entries with `id` in
 * `globalState`. The two classes were identical line for line, apart from the
 * password protection of the templates.
 */
const store = namedStore<TiSnippet>(STORAGE_KEY, {
  idPrefix: 'snip-',
  ctx: () => undefined, // Context always comes from the caller (`withCtx`).
});

export class SnippetStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get ops() { return store.withCtx(this.context); }

  getAll(): TiSnippet[] {
    return this.ops.list();
  }

  get(id: string): TiSnippet | undefined {
    return this.ops.get(id);
  }

  /**
   * Returns snippets visible for the given active server name.
   * Snippets without a servers filter are always included.
   * Pass undefined when no server is connected — returns only unfiltered snippets.
   */
  getFiltered(activeServer: string | undefined): TiSnippet[] {
    return this.getAll().filter(s => matchesServerScope(s.servers, activeServer));
  }

  save(snippet: TiSnippet): Thenable<void> {
    return this.ops.upsert(snippet);
  }

  delete(id: string): Thenable<void> {
    return this.ops.remove(id);
  }

  async exportToFile(): Promise<void> {
    const snippets = this.getAll();
    if (snippets.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No Snippets to export.'));
      return;
    }
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('tm1-snippets.json'),
      filters: { 'JSON': ['json'] },
      title: vscode.l10n.t('Export Snippets'),
    });
    if (!uri) { return; }
    const exportData = snippets.map(({ trigger, name, description, body }) => ({ trigger, name, description, body }));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8'));
    vscode.window.showInformationMessage(vscode.l10n.t('{0} Snippet(s) exported to {1}', snippets.length, uri.fsPath));
  }

  async importFromFile(onImported: () => void): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectMany: false,
      filters: { 'JSON': ['json'] },
      title: vscode.l10n.t('Import Snippets'),
    });
    if (!uris || uris.length === 0) { return; }
    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(uris[0]);
    } catch {
      vscode.window.showErrorMessage(vscode.l10n.t('Could not read file.'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw).toString('utf-8'));
    } catch {
      vscode.window.showErrorMessage(vscode.l10n.t('Invalid JSON format.'));
      return;
    }
    if (!Array.isArray(parsed)) {
      vscode.window.showErrorMessage(vscode.l10n.t('File must contain a JSON array of Snippets.'));
      return;
    }
    const imported: TiSnippet[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) { continue; }
      const { trigger, name, description, body } = item as Record<string, unknown>;
      if (typeof trigger !== 'string' || !trigger.trim()) { continue; }
      if (typeof name !== 'string' || !name.trim()) { continue; }
      imported.push({
        // `newId()` instead of a home-grown one: the blueprint counts up behind the
        // timestamp, otherwise several entries of the same tick collide.
        id: store.newId(),
        trigger: (trigger as string).trim(),
        name: (name as string).trim(),
        description: typeof description === 'string' ? description : '',
        body: typeof body === 'string' ? body : '',
      });
    }
    if (imported.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No valid Snippets found in the file.'));
      return;
    }
    await this.ops.replaceAll([...this.getAll(), ...imported]);
    onImported();
    vscode.window.showInformationMessage(vscode.l10n.t('{0} Snippet(s) imported.', imported.length));
  }
}
