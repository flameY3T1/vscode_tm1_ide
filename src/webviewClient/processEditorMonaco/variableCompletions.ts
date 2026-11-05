import type * as monacoType from 'monaco-editor';
import { collectIdentifierNames } from './tiIdentifiers';

interface NamedThing { Name: string; Type?: string | number }

// Monaco CompletionItemKind numeric literals
const KIND_FIELD = 3;
const KIND_VARIABLE = 4;
const KIND_TYPE_PARAMETER = 24;

export function registerVariableCompletions(
  monaco: typeof monacoType,
  getAllModels: () => monacoType.editor.ITextModel[],
  getParameters: () => NamedThing[],
  getDsVariables: () => NamedThing[],
): void {
  monaco.languages.registerCompletionItemProvider('ti', {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range: monacoType.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: monacoType.languages.CompletionItem[] = [];
      const seen = new Set<string>();

      for (const p of getParameters()) {
        const name = p.Name;
        if (!name) { continue; }
        const lower = name.toLowerCase();
        if (seen.has(lower)) { continue; }
        seen.add(lower);
        const typeLabel = p.Type === 2 || p.Type === 'String' ? 'String' : 'Numeric';
        suggestions.push({
          label: name,
          kind: KIND_TYPE_PARAMETER,
          insertText: name,
          detail: `Parameter (${typeLabel})`,
          sortText: '01' + lower,
          range,
        });
      }

      for (const v of getDsVariables()) {
        const name = v.Name;
        if (!name) { continue; }
        const lower = name.toLowerCase();
        if (seen.has(lower)) { continue; }
        seen.add(lower);
        const typeLabel = v.Type === 2 || v.Type === 'String' ? 'String' : 'Numeric';
        suggestions.push({
          label: name,
          kind: KIND_FIELD,
          insertText: name,
          detail: `Datasource-Variable (${typeLabel})`,
          sortText: '02' + lower,
          range,
        });
      }

      for (const ident of collectIdentifierNames(getAllModels().map((m) => m.getValue()))) {
        const lower = ident.toLowerCase();
        if (seen.has(lower)) { continue; }
        seen.add(lower);
        suggestions.push({
          label: ident,
          kind: KIND_VARIABLE,
          insertText: ident,
          detail: 'Variable',
          sortText: '03' + lower,
          range,
        });
      }

      return { suggestions };
    },
  });
}
