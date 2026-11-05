import { parseTiCode } from '../tiParser';
import { TI_SYSTEM_VARIABLES } from '../tiSystemVars';
import { KNOWN_SIGNATURES } from '../tiSignatures';
import { BARE_KEYWORDS } from './constants';
import { UndefinedVariable } from './types';
import { stripStringLiterals } from './helpers/parse';
import { collectReadsWithLines, collectAssignedVariables } from './helpers/reads';
import type { TiSection } from '../lintTypes';

const SECTION_ORDER: TiSection[] = ['prolog', 'metadata', 'data', 'epilog'];

/**
 * Checks all 4 TI sections for variables that are READ but never DEFINED.
 * A variable is considered defined if it is:
 *  - assigned anywhere in the code (any section)
 *  - a process parameter
 *  - a datasource variable (column mapping)
 *  - a TM1 system variable
 *
 * Returns the list of undefined variable names (original casing).
 */
export function findUndefinedVariables(
  sections: { prolog: string; metadata: string; data: string; epilog: string },
  paramNames: Set<string>,
  datasourceVarNames: Set<string>,
): UndefinedVariable[] {
  const allAssignedLower = new Set<string>();
  // Map lowercase → first original casing found in reads
  const originalNames = new Map<string, string>();
  // lowercase → location of the first AST-real read (section + 0-based line
  // within that section). Skips comment/string mentions, so the diagnostic
  // lands on the actual usage line instead of a lexical first-match on line 1.
  const firstRead = new Map<string, { section: TiSection; line: number }>();

  for (const section of SECTION_ORDER) {
    const code = sections[section];
    if (!code.trim()) { continue; }
    const result = parseTiCode(code);
    if (!result.ok) { continue; }

    for (const [lower, line1Based] of collectReadsWithLines(result.ast)) {
      if (!firstRead.has(lower)) {
        firstRead.set(lower, { section, line: Math.max(0, line1Based - 1) });
      }
    }
    for (const a of collectAssignedVariables(result.ast)) {
      allAssignedLower.add(a);
    }
  }

  // Collect original casing from raw code (strip string literals to avoid picking up their contents)
  const fullCode = stripStringLiterals([sections.prolog, sections.metadata, sections.data, sections.epilog].join('\n'));
  const identifiers = fullCode.match(/(?<![A-Za-zÄÖÜäöüß0-9_])[A-Za-zÄÖÜäöüß_][A-Za-zÄÖÜäöüß0-9_]*(?![A-Za-zÄÖÜäöüß0-9_])/g) ?? [];
  for (const id of identifiers) {
    const lower = id.toLowerCase();
    if (!originalNames.has(lower)) {
      originalNames.set(lower, id);
    }
  }

  const paramNamesLower = new Set([...paramNames].map(n => n.toLowerCase()));
  const dsVarNamesLower = new Set([...datasourceVarNames].map(n => n.toLowerCase()));

  const undefined_: UndefinedVariable[] = [];
  for (const [varLower, pos] of firstRead) {
    if (allAssignedLower.has(varLower)) { continue; }
    if (paramNamesLower.has(varLower)) { continue; }
    if (dsVarNamesLower.has(varLower)) { continue; }
    if (TI_SYSTEM_VARIABLES.has(varLower)) { continue; }
    if (KNOWN_SIGNATURES.has(varLower)) { continue; }
    if (BARE_KEYWORDS.has(varLower)) { continue; }
    undefined_.push({ name: originalNames.get(varLower) ?? varLower, section: pos.section, line: pos.line });
  }

  return undefined_.sort((a, b) => a.name.localeCompare(b.name));
}
