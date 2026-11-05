import type * as monacoType from 'monaco-editor';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import { buildSignatureLabel, buildSnippetInsertText, buildMarkdownDoc, markdownDocLabelsFromL10n } from '../_shared/tiSignatureRender';
import { SNIPPET_RULE, KIND_FUNCTION, KIND_KEYWORD, TAG_DEPRECATED } from '../_shared/monacoEnums';
import { getL10n } from '../_shared/l10n';
import { buildTiSkipMask } from '../_shared/tiSkipMask';

const MD_LABELS = markdownDocLabelsFromL10n(getL10n());

/**
 * Is this panel currently on v12? The host sends the value per panel (the
 * connection of the panel decides, not the one opened last), first as
 * the reply to `monacoReady`, then on every change.
 *
 * Preset to `false`, because that is the more common situation and because a
 * suggestion the server does not compile costs more than a missing one: until
 * the message arrives, the v12 functions stay out of the list.
 */
let v12Mode = false;

export function setV12Mode(on: boolean): void {
  v12Mode = on;
}

const CONTROL_FLOW = ['IF', 'ELSE', 'ELSEIF', 'ENDIF', 'WHILE', 'END', 'FOR', 'NEXT'];
// Note: TI process-control statements (ProcessError, ProcessQuit, ProcessBreak,
// ItemReject, ItemSkip, StringGlobalVariable, NumericGlobalVariable) are
// supplied by KNOWN_SIGNATURES with correct param snippets and bare-name
// insert for 0-arg void variants. A separate STATEMENTS list would duplicate
// them in the suggestion popup.
//
// buildSignatureLabel / buildSnippetInsertText / buildMarkdownDoc and the
// Monaco enum literals live in ../_shared (S3 dedup with the rule editor).

export function registerCompletions(monaco: typeof monacoType): void {
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

      for (const sig of KNOWN_SIGNATURES.values()) {
        // Rules-only functions (ISLEAF, CellValueN/S, Hierarchy*, UNDEF family) do not compile
        // in TI processes → do not offer them in process completion.
        if (sig.rulesOnly) continue;
        // Do not offer functions that only exist from v12 on (HTTP and job family) on an
        // 11.x server — there the compiler rejects them with an
        // error that the suggestion itself caused.
        if (sig.v12Only && !v12Mode) continue;
        suggestions.push({
          label: sig.name,
          kind: KIND_FUNCTION,
          insertText: buildSnippetInsertText(sig),
          insertTextRules: SNIPPET_RULE,
          detail: buildSignatureLabel(sig) + (sig.deprecatedInV12 ? ' — deprecated in v12' : ''),
          documentation: { value: buildMarkdownDoc(sig, MD_LABELS, v12Mode) },
          sortText: sig.deprecatedInV12 ? 'z' + sig.name : '1' + sig.name,
          range,
          tags: sig.deprecatedInV12 ? [TAG_DEPRECATED] : undefined,
        });
      }

      for (const kw of CONTROL_FLOW) {
        suggestions.push({
          label: kw,
          kind: KIND_KEYWORD,
          insertText: kw,
          detail: 'Control Flow',
          sortText: '0' + kw,
          range,
        });
      }

      return { suggestions };
    },
  });
}

export function registerHover(monaco: typeof monacoType): void {
  monaco.languages.registerHoverProvider('ti', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) { return null; }
      // Don't show a function description when the word sits inside a string
      // literal or comment — e.g. the process name in ExecuteProcess('##sleep')
      // must not be read as the TI function `Sleep`.
      const mask = buildTiSkipMask(model.getLineContent(position.lineNumber));
      if (mask[word.startColumn - 1]) { return null; }
      const sig = KNOWN_SIGNATURES.get(word.word.toLowerCase());
      if (!sig) { return null; }
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [{ value: buildMarkdownDoc(sig, MD_LABELS, v12Mode) }],
      };
    },
  });
}

/** Registers a second hover provider that shows live variable values while a
 *  debug session is paused. `lookup` returns the current value string or null. */
export function registerDebugValueHover(
  monaco: typeof monacoType,
  lookup: (ident: string) => string | null,
): void {
  monaco.languages.registerHoverProvider('ti', {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) { return null; }
      const value = lookup(word.word);
      if (value === null) { return null; }
      return {
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        },
        contents: [
          { value: `**${word.word}** = \`${value}\`` },
          { value: getL10n().liveDebugValue },
        ],
      };
    },
  });
}
