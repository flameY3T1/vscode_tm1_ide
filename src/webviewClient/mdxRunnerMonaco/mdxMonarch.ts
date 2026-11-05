import type * as monacoType from 'monaco-editor';
import { formatMdx } from '../../mdx/formatMdxPure';

// Standard MDX keywords. ignoreCase=true, so only one case form is needed here.
const KEYWORDS = [
  // Core clauses
  'SELECT', 'FROM', 'WHERE', 'WITH', 'AS',
  // Axis keywords
  'ON', 'COLUMNS', 'ROWS', 'PAGES', 'CHAPTERS', 'SECTIONS', 'AXIS',
  // Modifiers
  'NON', 'EMPTY', 'NOT', 'AND', 'OR', 'XOR',
  // Set / member functions
  'MEMBERS', 'CHILDREN', 'DESCENDANTS', 'ANCESTORS', 'ANCESTOR', 'PARENT',
  'HIERARCHIZE', 'ORDER', 'FILTER', 'DISTINCT', 'GENERATE',
  'CROSSJOIN', 'UNION', 'INTERSECT', 'EXCEPT', 'EXISTS', 'LEAVES',
  'HEAD', 'TAIL', 'SUBSET', 'ITEM',
  'BOTTOMCOUNT', 'BOTTOMPERCENT', 'BOTTOMSUM',
  'TOPCOUNT', 'TOPPERCENT', 'TOPSUM',
  'DRILLDOWNLEVEL', 'DRILLUPMEMBER', 'DRILLDOWNMEMBER',
  // TM1-specific
  'TM1SUBSETALL', 'TM1FILTERBYLEVEL', 'TM1FILTERBYPATTERN',
  'TM1SUBSETTOSET', 'TM1DRILLDOWNMEMBER',
  'ELEMENT', 'ROLLUP',
  // Aggregation
  'SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'MEDIAN', 'AGGREGATE',
  // Time / period
  'YTD', 'QTD', 'MTD', 'WTD', 'PARALLELPERIOD', 'LAG', 'LEAD',
  'PERIODSTODATE', 'CLOSINGPERIOD', 'OPENINGPERIOD',
  // Calc / logical
  'IIF', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'PROPERTIES', 'CURRENTMEMBER', 'DEFAULTMEMBER',
  'DIMENSION', 'HIERARCHY', 'LEVEL', 'LEVELS',
  'SET', 'MEMBER',
];

export function registerMdxLanguage(monaco: typeof monacoType): void {
  monaco.languages.register({ id: 'mdx', extensions: ['.mdx'] });

  monaco.languages.setLanguageConfiguration('mdx', {
    comments: { lineComment: '--', blockComment: ['/*', '*/'] },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });

  // Shift+Alt+F / context menu "Format Document" in every mdx editor (runner + popup).
  monaco.languages.registerDocumentFormattingEditProvider('mdx', {
    provideDocumentFormattingEdits(model) {
      const text = model.getValue();
      const formatted = formatMdx(text);
      if (formatted === text) { return []; }
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  });

  monaco.languages.setMonarchTokensProvider('mdx', {
    ignoreCase: true,
    defaultToken: '',
    keywords: KEYWORDS,
    tokenizer: {
      root: [
        // Block comment
        [/\/\*/, { token: 'comment', next: '@comment' }],
        // Line comment
        [/--.*$/, 'comment'],
        // String literals (double + single quoted)
        [/"(?:""|[^"])*"/, 'string'],
        [/'(?:''|[^'])*'/, 'string'],
        // Numbers
        [/\b\d+(?:\.\d+)?\b/, 'number'],
        // Bracketed identifier (MDX uses [Member] widely)
        [/\[[^\]]*\]/, 'identifier.bracketed'],
        // Keywords / identifiers
        [/[A-Za-z_][A-Za-z0-9_]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        // Operators + punctuation
        [/[=<>!]+/, 'operator'],
        [/[+\-*/:.]/, 'operator'],
        [/[,;]/, 'delimiter'],
      ],
      comment: [
        [/[^*/]+/, 'comment'],
        [/\*\//, { token: 'comment', next: '@pop' }],
        [/./, 'comment'],
      ],
    },
  });

  monaco.editor.defineTheme('mdx-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'identifier.bracketed', foreground: '9cdcfe' },
      { token: 'identifier', foreground: 'd4d4d4' },
      { token: 'operator', foreground: 'd4d4d4' },
      { token: 'delimiter', foreground: 'd4d4d4' },
    ],
    colors: {},
  });

  monaco.editor.defineTheme('mdx-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'string', foreground: 'a31515' },
      { token: 'number', foreground: '098658' },
      { token: 'keyword', foreground: 'af00db' },
      { token: 'identifier.bracketed', foreground: '001080' },
    ],
    colors: {},
  });
}
