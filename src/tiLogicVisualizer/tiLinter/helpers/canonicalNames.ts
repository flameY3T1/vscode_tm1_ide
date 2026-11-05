import { KNOWN_SIGNATURES } from '../../tiSignatures';
import { TI_KEYWORDS, BARE_KEYWORDS } from '../constants';
import { TI_SYSTEM_VARIABLES } from '../../tiSystemVars';
import { maskLine } from './maskCode';
import { SECTION_ORDER, IDENT_RE, type TiSections } from './sectionScan';

const ASSIGN_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/;

const SYSTEM_VARS_LOWER = new Set([...TI_SYSTEM_VARIABLES].map(v => v.toLowerCase()));

function isReserved(lower: string): boolean {
  return TI_KEYWORDS.has(lower) || BARE_KEYWORDS.has(lower)
    || KNOWN_SIGNATURES.has(lower) || SYSTEM_VARS_LOWER.has(lower);
}


function scanSection(text: string): { assignFirst: Map<string, string>; anyFirst: Map<string, string> } {
  const assignFirst = new Map<string, string>();
  const anyFirst = new Map<string, string>();
  for (const rawLine of text.split('\n')) {
    const code = maskLine(rawLine);
    const assignM = ASSIGN_RE.exec(code);
    const assignTargetLower = assignM ? assignM[1].toLowerCase() : null;
    let m: RegExpExecArray | null;
    IDENT_RE.lastIndex = 0;
    while ((m = IDENT_RE.exec(code)) !== null) {
      const name = m[0];
      const lower = name.toLowerCase();
      if (isReserved(lower)) { continue; }
      if (!anyFirst.has(lower)) { anyFirst.set(lower, name); }
      // Only count this identifier as the assignment TARGET when it is the LHS
      // token of `x = ...` (ASSIGN_RE is ^-anchored, so assignM.index is 0). This
      // excludes RHS re-uses like `vX = vX + 1` and comparisons like `If(vFlag = 1)`.
      if (assignTargetLower === lower && assignM && m.index === assignM.index + assignM[0].indexOf(name)) {
        if (!assignFirst.has(lower)) { assignFirst.set(lower, name); }
      }
    }
  }
  return { assignFirst, anyFirst };
}

export function buildCanonicalNames(
  sections: TiSections,
  paramNames: string[],
  datasourceVarNames: string[],
): Map<string, string> {
  const canonical = new Map<string, string>();
  for (const p of paramNames) { if (!canonical.has(p.toLowerCase())) { canonical.set(p.toLowerCase(), p); } }
  for (const d of datasourceVarNames) { if (!canonical.has(d.toLowerCase())) { canonical.set(d.toLowerCase(), d); } }
  const scans = SECTION_ORDER.map(s => scanSection(sections[s]));
  for (const { assignFirst } of scans) {
    for (const [lower, name] of assignFirst) { if (!canonical.has(lower)) { canonical.set(lower, name); } }
  }
  for (const { anyFirst } of scans) {
    for (const [lower, name] of anyFirst) { if (!canonical.has(lower)) { canonical.set(lower, name); } }
  }
  return canonical;
}
