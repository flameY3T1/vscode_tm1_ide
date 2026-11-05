// src/security/core/permLevels.ts
import type { ResourceType, PermLevel } from '../types/permission';

export const LEVELS_PER_RESOURCE: Record<ResourceType, readonly PermLevel[]> = {
  cube:      ['NONE','READ','WRITE','RESERVE','LOCK','ADMIN'],
  dimension: ['NONE','READ','WRITE','ADMIN'],
  hierarchy: ['NONE','READ','WRITE','ADMIN'],
  element:   ['NONE','READ','WRITE'],
  process:   ['NONE','READ'],
};
