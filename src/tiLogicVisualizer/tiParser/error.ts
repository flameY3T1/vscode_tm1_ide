/**
 * ParseError class for tiParser modules.
 *
 * Extracted from `tiParser.ts` in Post-H17 #6 split.
 */

export {};

export class ParseError extends Error {
  constructor(
    public line: number,
    public messageKey: string,
    public messageArgs: (string | number)[] = [],
  ) {
    // `.message` holds the English l10n key, used only for code-detection
    // (e.g. `.includes('semicolon')`) — never displayed raw. Display callers
    // render via `vscode.l10n.t(messageKey, ...messageArgs)`.
    super(messageKey);
  }
}
