/**
 * The one HTTP failure type and the one 2xx test. Pure — no transport, no
 * vscode — so every layer can import it.
 *
 * Before: 46 throws carried the status only in the message text and 143 call
 * sites spelled out `>= 200 && < 300` themselves (review 2026-10-04, A3/W13).
 * A caller that wants to treat 403 or 404 differently now checks
 * `e instanceof Tm1HttpError && e.statusCode === 404` instead of parsing text.
 */

export class Tm1HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    /** OData `error.code` when the body carried one. */
    readonly odataCode?: string,
  ) {
    super(message);
    this.name = 'Tm1HttpError';
  }
}

export function isOk(res: { statusCode: number }): boolean {
  return res.statusCode >= 200 && res.statusCode < 300;
}
