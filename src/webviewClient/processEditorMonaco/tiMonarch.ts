import type * as monacoType from 'monaco-editor';

const CONTROL_FLOW = [
  'IF', 'ELSE', 'ELSEIF', 'ENDIF',
  'WHILE', 'END',
  'FOR', 'NEXT',
];

const KEYWORDS = [
  'ProcessError', 'ProcessQuit', 'ProcessBreak', 'Break',
  'ItemReject', 'ItemSkip',
  'StringGlobalVariable', 'NumericGlobalVariable',
];

export function registerTiLanguage(
  monaco: typeof monacoType,
  builtins: string[],
): void {
  monaco.languages.register({ id: 'ti', extensions: ['.ti', '.pro'] });

  monaco.languages.setLanguageConfiguration('ti', {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '"', close: '"', notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider('ti', {
    ignoreCase: true,
    defaultToken: '',
    keywords: KEYWORDS,
    controlFlow: CONTROL_FLOW,
    builtins: builtins,
    tokenizer: {
      root: [
        [/^57[2345],\d*\s*$/, 'metatag'],
        [/^#\*{4}(?:Begin|End):.*$/, 'metatag'],
        [/^(?!57[2345],)\d+,.*$/, 'comment.header'],
        [/#.*$/, 'comment'],
        [/'(?:''|[^'])*'/, 'string'],
        [/"(?:""|[^"])*"/, 'string'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
        [/[a-zA-Z_][a-zA-Z0-9_]*/, {
          cases: {
            '@controlFlow': 'keyword.control',
            '@keywords': 'keyword',
            '@builtins': 'type.identifier',
            '@default': 'identifier',
          },
        }],
        [/[@=<>!]+/, 'operator'],
        [/[;,.]/, 'delimiter'],
      ],
    },
  });

  monaco.editor.defineTheme('ti-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'comment.header', foreground: '808080' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'keyword.control', foreground: '569cd6' },
      { token: 'type.identifier', foreground: 'dcdcaa' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'metatag', foreground: '4ec9b0', fontStyle: 'bold' },
      { token: 'operator', foreground: 'd4d4d4' },
    ],
    colors: {},
  });

  monaco.editor.defineTheme('ti-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'comment.header', foreground: '808080' },
      { token: 'string', foreground: 'a31515' },
      { token: 'number', foreground: '098658' },
      { token: 'keyword', foreground: 'af00db' },
      { token: 'keyword.control', foreground: '0000ff' },
      { token: 'type.identifier', foreground: '795e26' },
      { token: 'identifier', foreground: '001080' },
      { token: 'metatag', foreground: '267f99', fontStyle: 'bold' },
    ],
    colors: {},
  });
}
