/**
 * The own TM1 snippets as suggestions in the process editor.
 *
 * The native editor has always been able to do this (`snippets/snippetCompletionProvider.ts`
 * for `.ti`/`.pro`), the webview could not — and not on purpose: the wire
 * from `extension.ts` via `ProcessEditorManager` as far as
 * `processEditor/state.ts#_getSnippets` was completely laid, but nobody
 * read it. The same disease as with the v12 state, which `lifecycle.ts` records
 * in its comment: the message is sent, nobody evaluates it.
 *
 * The selection rules deliberately follow the native provider, so that the same snippet
 * appears in both editors for the same input: word of two or more characters,
 * comparison against the TRIGGER (not the name), display under the name,
 * sorted to the end of the list.
 */
import type * as monacoType from 'monaco-editor';
import type { WebviewSnippet } from './protocol';

export type { WebviewSnippet };

/** Monaco `CompletionItemKind.Snippet`. */
const KIND_SNIPPET = 27;
/** Monaco `CompletionItemInsertTextRule.InsertAsSnippet` — macht `$1`/`$0` scharf. */
const INSERT_AS_SNIPPET = 4;

let _snippets: WebviewSnippet[] = [];

/** Accept the list sent by the host (on opening and on every change). */
export function receiveSnippets(snippets: WebviewSnippet[] | undefined): void {
  _snippets = Array.isArray(snippets) ? snippets : [];
}

/** Only for tests and troubleshooting. */
export function getSnippetsForTest(): WebviewSnippet[] {
  return _snippets;
}

export function registerSnippetCompletions(monaco: typeof monacoType): void {
  monaco.languages.registerCompletionItemProvider('ti', {
    provideCompletionItems: (model, position) => {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const wordMatch = /[A-Za-z_]\w*$/.exec(before);
      // From two characters on — like the native provider. Without this limit, after
      // every single letter the whole snippet list pushes itself in front of the
      // function and variable suggestions.
      if (!wordMatch || wordMatch[0].length < 2) { return { suggestions: [] }; }
      const typed = wordMatch[0].toLowerCase();

      const word = model.getWordUntilPosition(position);
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monacoType.languages.CompletionItem[] = [];
      for (const s of _snippets) {
        if (!s.trigger || !s.trigger.toLowerCase().startsWith(typed)) { continue; }
        const lines = s.body.split('\n');
        const preview = lines.slice(0, 5).join('\n') + (lines.length > 5 ? '\n…' : '');
        suggestions.push({
          label: s.name,
          kind: KIND_SNIPPET,
          insertText: s.body,
          insertTextRules: INSERT_AS_SNIPPET,
          detail: `[${s.trigger}]  TM1 Snippet`,
          documentation: {
            value: (s.description ? `${s.description}\n\n` : '') + '```\n' + preview + '\n```',
          },
          // Filtering is by the TRIGGER, the NAME is displayed — otherwise you would have to
          // type the name to find your own abbreviation snippet.
          filterText: s.trigger,
          // To the end: the language suggestions are the more frequent intent while typing
          // (same choice as in the native provider, there 'zzz_').
          sortText: 'zzz_' + s.trigger.toLowerCase(),
          range,
        });
      }
      return { suggestions };
    },
  });
}
