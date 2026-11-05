// TI string literal escape for generated TI code (`CubeSaveData('<cube>');`).
// Own grammar, do NOT mix with escapeODataKey (utils/odataKey.ts): the
// transformation happens to be identical today (`'` → `''`), but OData keys and
// TI literals are separate languages — an OData escaper at a TI site is
// wrong, even if the result is right.
//
// In addition: TI has NO escape sequence for control characters. A line break
// in the name would break the literal open and execute the rest of the line as its own
// statement. Such values are rejected instead of
// producing broken TI code.

/** Value cannot be represented in a TI string literal. */
export class TiLiteralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TiLiteralError';
  }
}

/** First C0 control character (incl. CR/LF/TAB) or DEL in the string — otherwise -1. */
function firstControlChar(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) { return c; }
  }
  return -1;
}

/**
 * Escapes a value for use INSIDE a single-quoted
 * TI string literal (`'…'`): `'` → `''`.
 *
 * @throws {TiLiteralError} if the value contains a control character (incl. line break)
 * — the literal could not be represented safely.
 */
export function escapeTiLiteral(s: string): string {
  const bad = firstControlChar(s);
  if (bad >= 0) {
    const code = bad.toString(16).toUpperCase().padStart(4, '0');
    throw new TiLiteralError(
      `Value cannot be used in TI code: it contains the control character U+${code}.`,
    );
  }
  return s.replace(/'/g, "''");
}
