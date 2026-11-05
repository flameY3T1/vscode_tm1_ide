import { buildCanonicalNames } from './helpers/canonicalNames';
import { maskLine } from './helpers/maskCode';
import { SECTION_ORDER, IDENT_RE, type TiSections } from './helpers/sectionScan';
import type { TiSection } from '../lintTypes';

export interface InconsistentCasing { name: string; canonical: string; section: TiSection; line: number; }


export function findInconsistentCasing(
  sections: TiSections,
  paramNames: string[],
  datasourceVarNames: string[],
): InconsistentCasing[] {
  const canonical = buildCanonicalNames(sections, paramNames, datasourceVarNames);
  const out: InconsistentCasing[] = [];
  for (const section of SECTION_ORDER) {
    const lines = sections[section].split('\n');
    for (let line = 0; line < lines.length; line++) {
      const code = maskLine(lines[line]);
      let m: RegExpExecArray | null;
      IDENT_RE.lastIndex = 0;
      while ((m = IDENT_RE.exec(code)) !== null) {
        const name = m[0];
        const canon = canonical.get(name.toLowerCase());
        if (canon && canon !== name) {
          out.push({ name, canonical: canon, section, line });
        }
      }
    }
  }
  return out;
}
