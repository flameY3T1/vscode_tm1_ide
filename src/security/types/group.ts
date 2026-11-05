// src/security/types/group.ts
export interface Group {
  name: string;
  isSystem: boolean;
  memberCount: number;
}

export const SYSTEM_GROUPS = ['ADMIN', 'SecurityAdmin', 'DataAdmin', 'OperationsAdmin'] as const;

export function isSystemGroup(name: string): boolean {
  return SYSTEM_GROUPS.includes(name as typeof SYSTEM_GROUPS[number]);
}
