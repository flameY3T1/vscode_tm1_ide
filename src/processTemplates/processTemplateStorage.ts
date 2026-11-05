import * as vscode from 'vscode';
import type { ProcessTemplate } from './processTemplateTypes';
import { redactTemplatePassword } from './templatePasswordGuard';
import { namedStore } from '../serverState/namedStore';
import { matchesServerScope } from '../utils/serverScopePure';

const STORAGE_KEY = 'tm1.processTemplates';

/**
 * Built on the `serverState/namedStore` blueprint — the same family as the
 * snippets next door (`snippets/snippetStorage.ts`), the server profiles and the
 * login sets: a list of entries with `id` in `globalState`.
 *
 * `sanitize` carries the password protection at BOTH ends: `save` keeps it out
 * of `globalState`, `getAll` keeps entries written before the protection
 * out of the export bundle and the editor webview. That is exactly why
 * it lives in the blueprint and not in the two call sites.
 */
const store = namedStore<ProcessTemplate>(STORAGE_KEY, {
  idPrefix: 'tpl-',
  ctx: () => undefined, // Context always comes from the caller (`withCtx`).
  sanitize: redactTemplatePassword,
});

export class ProcessTemplateStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get ops() { return store.withCtx(this.context); }

  getAll(): ProcessTemplate[] {
    return this.ops.list();
  }

  get(id: string): ProcessTemplate | undefined {
    return this.ops.get(id);
  }

  /**
   * Returns templates visible for the given active server name.
   * Templates without a servers filter are always included.
   * Pass undefined when no server is connected — returns only unfiltered templates.
   */
  getFiltered(activeServer: string | undefined): ProcessTemplate[] {
    return this.getAll().filter(t => matchesServerScope(t.servers, activeServer));
  }

  save(tpl: ProcessTemplate): Thenable<void> {
    return this.ops.upsert(tpl);
  }

  delete(id: string): Thenable<void> {
    return this.ops.remove(id);
  }
}
