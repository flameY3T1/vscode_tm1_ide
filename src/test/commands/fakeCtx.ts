import * as vscode from 'vscode';

/** ExtensionContext mock with a REAL secret store — the stub in
 *  `adminServerTree.test.ts` always returns '' and is no use here. */
export function fakeContext(): vscode.ExtensionContext {
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  return {
    extensionUri: vscode.Uri.file('/ext'),
    globalState: {
      get: (k: string, dflt?: unknown) => (state.has(k) ? state.get(k) : dflt),
      update: async (k: string, v: unknown) => { state.set(k, v); },
    },
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => { secrets.set(k, v); },
      delete: async (k: string) => { secrets.delete(k); },
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}
