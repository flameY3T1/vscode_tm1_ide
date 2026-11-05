import type * as monacoType from 'monaco-editor';

const SECTION_KEYWORDS = ['SKIPCHECK', 'FEEDERS', 'FEEDSTRINGS', 'STET', 'CONTINUE'];
const CONTROL_FLOW     = ['IF', 'ELSE', 'ELSEIF', 'ENDIF'];

export function registerRulesLanguage(
  monaco: typeof monacoType,
  builtins: string[],
): void {
  monaco.languages.register({ id: 'tm1rules', extensions: ['.rux'] });

  monaco.languages.setLanguageConfiguration('tm1rules', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('tm1rules', {
    ignoreCase: true,
    defaultToken: '',
    sectionKeywords: SECTION_KEYWORDS,
    controlFlow: CONTROL_FLOW,
    builtins: builtins,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/'(?:''|[^'])*'/, 'string'],
        [/"(?:""|[^"])*"/, 'string'],
        // Rule type prefix after '=' (C:, N:, S:) — token the letter only
        [/(=)(\s*)([CNS])(:)/, ['operator', '', 'keyword.ruletype', 'delimiter']],
        // Feeder operator =>
        [/=>/, 'keyword.feeder'],
        // !DimensionName element iterator
        [/![A-Za-z_][A-Za-z0-9_]*/, 'keyword.dimelem'],
        // [cell reference]  ['Dim':'Elem']
        [/\[/, { token: 'delimiter.cellref', next: '@cellref' }],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, {
          cases: {
            '@sectionKeywords': 'keyword.section',
            '@controlFlow': 'keyword.control',
            '@builtins': 'type.identifier',
            '@default': 'identifier',
          },
        }],
        [/[@=<>!]+/, 'operator'],
        [/[;,.]/, 'delimiter'],
      ],
      cellref: [
        [/\]/, { token: 'delimiter.cellref', next: '@pop' }],
        [/'(?:''|[^'])*'/, 'string.cellref'],
        [/"(?:""|[^"])*"/, 'string.cellref'],
        [/!/, 'keyword.dimelem'],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, 'identifier.cellref'],
        [/[:,]/, 'delimiter.cellref'],
        [/\s+/, ''],
        [/./, 'cellref.content'],
      ],
    },
  });

  monaco.editor.defineTheme('tm1rules-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'string.cellref', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'keyword.section', foreground: 'c586c0' },
      { token: 'keyword.control', foreground: '569cd6' },
      { token: 'keyword.ruletype', foreground: 'c586c0' },
      { token: 'keyword.feeder', foreground: 'c586c0' },
      { token: 'keyword.dimelem', foreground: '9cdcfe', fontStyle: 'italic' },
      { token: 'type.identifier', foreground: 'dcdcaa' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'identifier.cellref', foreground: '4ec9b0' },
      { token: 'delimiter.cellref', foreground: '4ec9b0' },
      { token: 'operator', foreground: 'd4d4d4' },
    ],
    colors: {},
  });

  monaco.editor.defineTheme('tm1rules-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'string', foreground: 'a31515' },
      { token: 'string.cellref', foreground: 'a31515' },
      { token: 'number', foreground: '098658' },
      { token: 'keyword.section', foreground: 'af00db' },
      { token: 'keyword.control', foreground: '0000ff' },
      { token: 'keyword.ruletype', foreground: 'af00db' },
      { token: 'keyword.feeder', foreground: 'af00db' },
      { token: 'keyword.dimelem', foreground: '267f99', fontStyle: 'italic' },
      { token: 'type.identifier', foreground: '795e26' },
      { token: 'identifier', foreground: '001080' },
      { token: 'identifier.cellref', foreground: '267f99' },
      { token: 'delimiter.cellref', foreground: '267f99' },
    ],
    colors: {},
  });
}
