/**
 * Monaco editor enum values as numeric literals.
 *
 * The bundled/ESM Monaco build does not always populate
 * `monaco.languages.CompletionItemKind` / `CompletionItemInsertTextRules` /
 * `CompletionItemTag` at the point our completion providers run, so every
 * Monaco webview client hard-codes these magic numbers. Centralised here (S3)
 * to kill the copy-paste across processEditor / ruleEditor / mdxRunner
 * completion modules. Values mirror monaco-editor's `monaco.languages.*` enums.
 */

export {};

/** CompletionItemInsertTextRules.InsertAsSnippet */
export const SNIPPET_RULE = 4;

// ── CompletionItemKind ──────────────────────────────────────────────
export const KIND_FUNCTION = 1;
export const KIND_VALUE = 12;
export const KIND_KEYWORD = 17;
export const KIND_SNIPPET = 25;

/** CompletionItemTag.Deprecated */
export const TAG_DEPRECATED = 1;
