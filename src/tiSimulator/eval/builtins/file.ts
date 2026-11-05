/**
 * File output built-ins.
 * Hebel 11 (2026-05-17): extracted from the former single-file builtins module.
 *
 * Section 8 (L888-894): redirected to log markers by the rewriter; simulator
 * no-ops them and lets `buildOpRow` record `GenericMetaRow` entries for diff.
 */

import { type Builtin, noopVoid } from './_helpers';

export const FILE_OUTPUT_BUILTINS: Builtin[] = [
  noopVoid('TextOutput', 1, 99),
  noopVoid('ASCIIOutput', 1, 99),
  noopVoid('ASCIIOutputOpen', 1, 2),
  noopVoid('ASCIIOutputClose', 1, 1),
  noopVoid('SetOutputCharacterSet', 2, 2),
];
