/**
 * Known TM1 / Planning Analytics status codes and error codes.
 * Used by the linter to give hints on numeric literals in comparisons.
 *
 * Sources: TM1 Developer Reference, PA REST API Documentation, TI Function Reference.
 * Descriptions are canonically English (emitted by the error-code diagnostic as
 * `{0} = {1}`; separate localisation would be data effort).
 */

/** TM1 error codes that are typically compared in TI code */
export const TM1_CONDITION_CODES: Record<string, string> = {
  // CellGet / CellPut Sicherheitsfehler
  '6':    'Access denied (no write permission on cell)',
  // Dimension / Element Fehler
  '1178': 'Element not found in dimension',
  '1179': 'Dimension not found',
  '1206': 'Cube not found',
  '1415': 'Hierarchy not found',
  // Subset / View Fehler
  '1317': 'Subset not found',
  '1382': 'View not found',
  // Prozess-Fehler
  '211':  'Too many iterations in WHILE loop (TM1 limit exceeded)',
  '286':  'Process was aborted by the server',
  // Allgemeine Fehler
  '68':   'Process ended with an error (general runtime error)',
};
