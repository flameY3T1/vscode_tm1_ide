// Pure planning for file mode: which section changes, and by which smallest edit.
import { minimalReplace, type TextReplace } from '../_shared/minimalReplacePure';
import type { SectionKey } from './sectionTypes';

const ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];

export function planSectionEdits(
  current: Record<SectionKey, string>, next: Partial<Record<SectionKey, string>>,
): Array<{ section: SectionKey; edit: TextReplace }> {
  const out: Array<{ section: SectionKey; edit: TextReplace }> = [];
  for (const section of ORDER) {
    const target = next[section];
    if (target === undefined) { continue; }
    const edit = minimalReplace(current[section], target);
    if (edit) { out.push({ section, edit }); }
  }
  return out;
}
