export interface ElementMeta { name: string; type: string; level: number }

export interface HierarchyStructure {
  childrenOf: Record<string, string[]>;
  parentOf: Record<string, string | undefined>;
  allParentsOf: Record<string, string[]>;
  meta: Record<string, ElementMeta>;
}
