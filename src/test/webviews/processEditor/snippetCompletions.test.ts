// The process editor webview did not know its own snippets — not on
// purpose: the wire was laid, only nobody read it
// (`processEditor/state.ts#_getSnippets`, written and never read).
//
// What is checked here above all is the congruence with the NATIVE provider
// (`snippets/snippetCompletionProvider.ts`): the same snippet must appear in both
// editors for the same input, otherwise the feature is worse
// than none.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerSnippetCompletions, receiveSnippets, getSnippetsForTest,
} from '../../../webviewClient/processEditorMonaco/snippetCompletions';

type Provider = {
  provideCompletionItems: (model: unknown, pos: unknown) => { suggestions: Array<Record<string, unknown>> };
};

let provider: Provider;

/** Model stub: one line, cursor at the end of what was typed. */
function tippe(text: string) {
  const wort = /[A-Za-z_]\w*$/.exec(text)?.[0] ?? '';
  return {
    model: {
      getLineContent: () => text,
      getWordUntilPosition: () => ({
        startColumn: text.length + 1 - wort.length,
        endColumn: text.length + 1,
      }),
    },
    position: { lineNumber: 1, column: text.length + 1 },
  };
}

function vorschlaege(text: string): Array<Record<string, unknown>> {
  const { model, position } = tippe(text);
  return provider.provideCompletionItems(model, position).suggestions;
}

const SNIP = {
  id: 's1', trigger: 'zdim', name: 'Dimension anlegen',
  description: 'Legt eine Dimension an', body: 'DimensionCreate(${1:pDim});\n$0',
};

beforeEach(() => {
  const monaco = {
    languages: {
      registerCompletionItemProvider: vi.fn((_lang: string, p: Provider) => { provider = p; }),
    },
  };
  registerSnippetCompletions(monaco as never);
  receiveSnippets([SNIP]);
});

describe('Snippet-Vorschlaege im Prozesseditor', () => {
  it('suggests from TWO characters on, not from one', () => {
    // Without the threshold, after every letter the whole
    // snippet list pushes itself in front of the function and variable suggestions. The native
    // provider draws the same limit.
    expect(vorschlaege('z')).toHaveLength(0);
    expect(vorschlaege('zd')).toHaveLength(1);
  });

  it('matches against the TRIGGER, but shows the NAME', () => {
    const [v] = vorschlaege('zd');
    expect(v.label).toBe('Dimension anlegen');
    expect(v.filterText).toBe('zdim');
    // Filtering by the name would mean: you would have to type the name to
    // find its own shortcut snippet.
    expect(vorschlaege('Dimen')).toHaveLength(0);
  });

  it('inserts as a SNIPPET so that the tab stops are live', () => {
    const [v] = vorschlaege('zd');
    expect(v.insertText).toBe(SNIP.body);
    expect(v.insertTextRules).toBe(4); // InsertAsSnippet
  });

  it('sorts to the end of the list', () => {
    // While typing, the language is the more frequent intent; the same choice as in the
    // native provider ('zzz_').
    expect(String(vorschlaege('zd')[0].sortText)).toMatch(/^zzz_/);
  });

  it('is case-insensitive', () => {
    expect(vorschlaege('ZD')).toHaveLength(1);
  });

  it('returns nothing for a foreign prefix and without snippets', () => {
    expect(vorschlaege('xy')).toHaveLength(0);
    receiveSnippets([]);
    expect(vorschlaege('zd')).toHaveLength(0);
  });

  it('copes with a missing or broken list', () => {
    receiveSnippets(undefined);
    expect(getSnippetsForTest()).toEqual([]);
    expect(vorschlaege('zd')).toHaveLength(0);
    receiveSnippets('kein Array' as never);
    expect(vorschlaege('zd')).toHaveLength(0);
  });

  it('skips a snippet without a trigger instead of offering it everywhere', () => {
    receiveSnippets([{ ...SNIP, trigger: '' }]);
    expect(vorschlaege('zd')).toHaveLength(0);
  });

  it('replaces exactly the typed word', () => {
    const [v] = vorschlaege('  zdi');
    expect(v.range).toEqual({
      startLineNumber: 1, endLineNumber: 1, startColumn: 3, endColumn: 6,
    });
  });
});
