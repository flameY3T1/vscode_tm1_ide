// src/usageCheck/elementUsage.ts
import type { ReferenceIndex } from '../references/referenceTypes';
import { escapeRegex } from '../utils/escapeRegexPure';

export type UsageKind = 'rule' | 'process' | 'subset' | 'view';

export interface UsageRef {
  kind: UsageKind;
  sourceName: string;             // Cube / Process / Subset / View name
  section?: string;
  line?: number;
  snippet?: string;
}

export interface FindElementRefsDeps {
  dim: string;
  element: string;
  index: ReferenceIndex;
  cubesContainingDim: string[];
  subsetsFetcher: () => Promise<Array<{ name: string; isPrivate: boolean; elements: string[] }>>;
  viewsFetcher: () => Promise<Array<{ name: string; isPrivate: boolean; elements: string[] }>>;
}

export async function findElementReferences(deps: FindElementRefsDeps): Promise<UsageRef[]> {
  const out: UsageRef[] = [];
  const elemLc = deps.element.toLowerCase();
  const dimLc = deps.dim.toLowerCase();

  // 1. Rules + Processes from ReferenceIndex
  for (const ref of deps.index.all) {
    if (ref.targetKind !== 'dimension' || ref.targetName.toLowerCase() !== dimLc) continue;
    // Look for exact element-name occurrence in the snippet (with word-boundary-like match)
    const snippet = ref.snippet ?? '';
    const pattern = new RegExp(`['"\\[]\\s*${escapeRegex(deps.element)}\\s*['"\\]]`, 'i');
    if (!pattern.test(snippet)) continue;
    out.push({
      kind: ref.sourceKind === 'rule' ? 'rule' : 'process',
      sourceName: ref.sourceName,
      section: ref.section,
      line: ref.line,
      snippet: snippet.slice(0, 200),
    });
  }

  // 2. Subsets
  const subsets = await deps.subsetsFetcher();
  for (const s of subsets) {
    if (s.elements.some(e => e.toLowerCase() === elemLc)) {
      out.push({ kind: 'subset', sourceName: `${s.isPrivate ? '[priv] ' : ''}${s.name}` });
    }
  }

  // 3. Views (AnonymousSubset element lists)
  const views = await deps.viewsFetcher();
  for (const v of views) {
    if (v.elements.some(e => e.toLowerCase() === elemLc)) {
      out.push({ kind: 'view', sourceName: `${v.isPrivate ? '[priv] ' : ''}${v.name}` });
    }
  }

  return out;
}

