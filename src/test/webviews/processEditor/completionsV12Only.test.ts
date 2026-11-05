import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * The process editor in the webview rebuilds its suggestion list on EVERY keystroke —
 * so the v12 state may be a simple module flag that the host sets via
 * `v12ModeChanged`. Exactly that is checked here: flip the flag, the list changes.
 *
 * The default is `false`. As long as the host's message has not arrived, the
 * v12 functions therefore stay out of the list — a missing suggestion costs less than one
 * that the 11.x compiler rejects.
 */

/** Only as much Monaco as `registerCompletions` touches. */
type Provider = { provideCompletionItems: (model: unknown, position: unknown) => { suggestions: Array<{ label: unknown }> } };
let provider: Provider;
let setV12Mode: (on: boolean) => void;

const model = {
  getWordUntilPosition: () => ({ word: '', startColumn: 1, endColumn: 1 }),
  getValue: () => '',
  getValueInRange: () => '',
  getLineContent: () => '',
};
const position = { lineNumber: 1, column: 1 };

function labels(): string[] {
  return provider.provideCompletionItems(model, position).suggestions.map(s => String(s.label));
}

beforeAll(async () => {
  const mod = await import('../../../webviewClient/processEditorMonaco/completions');
  setV12Mode = mod.setV12Mode;
  const fakeMonaco = {
    languages: {
      registerCompletionItemProvider: (_lang: string, p: Provider) => { provider = p; },
      registerHoverProvider: () => { /* nicht Gegenstand dieses Tests */ },
      CompletionItemKind: {},
      CompletionItemInsertTextRule: {},
    },
  };
  mod.registerCompletions(fakeMonaco as never);
});

// The flag is module-global and survives every test — without a reset the
// default test only checks what the most recently run test left behind.
beforeEach(() => {
  setV12Mode(false);
});

describe('processEditor completions — v12-only functions', () => {
  it('omits them by default (no host message yet)', () => {
    const l = labels();
    expect(l).not.toContain('ExecuteHttpRequest');
    expect(l).not.toContain('WaitForAllJobs');
    expect(l).toContain('CellGetN');
  });

  it('offers them after the host reports v12', () => {
    setV12Mode(true);
    const l = labels();
    expect(l).toContain('ExecuteHttpRequest');
    expect(l).toContain('WaitForAllJobs');
  });

  it('drops them again when the panel moves back to 11.x', () => {
    setV12Mode(true);
    expect(labels()).toContain('ExecuteHttpRequest');
    setV12Mode(false);
    expect(labels()).not.toContain('ExecuteHttpRequest');
  });
});
