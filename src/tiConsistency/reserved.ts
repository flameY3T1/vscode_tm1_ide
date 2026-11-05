import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';
import { TI_KEYWORDS, BARE_KEYWORDS, PROLOG_ONLY_ASSIGN } from '../tiLogicVisualizer/tiLinter/constants';
import { TI_SYSTEM_VARIABLES } from '../tiLogicVisualizer/tiSystemVars';

/**
 * True if `nameLc` (lowercase) is a reserved TI identifier that must NOT be
 * treated as a renameable variable: a known function, a keyword, or a TI SYSTEM
 * variable (Datasource* config vars etc. — renaming those breaks the process).
 *
 * `TI_SYSTEM_VARIABLES` derives its `datasource*` members from `KNOWN_SIGNATURES`
 * (runtime-loaded, may be empty in some test contexts), so `PROLOG_ONLY_ASSIGN`
 * (hardcoded) is included too as a reliable backstop for the datasource-config vars.
 */
export function isReservedName(nameLc: string): boolean {
  return KNOWN_SIGNATURES.has(nameLc)
    || TI_KEYWORDS.has(nameLc)
    || BARE_KEYWORDS.has(nameLc)
    || TI_SYSTEM_VARIABLES.has(nameLc)
    || PROLOG_ONLY_ASSIGN.has(nameLc);
}
