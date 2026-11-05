// src/security/types/permission.ts
export type ResourceType = 'cube' | 'dimension' | 'hierarchy' | 'element' | 'process';

export type CubePermLevel = 'NONE' | 'READ' | 'WRITE' | 'RESERVE' | 'LOCK' | 'ADMIN';
export type DimPermLevel = 'NONE' | 'READ' | 'WRITE' | 'ADMIN';
export type HierPermLevel = 'NONE' | 'READ' | 'WRITE' | 'ADMIN';
export type ElementPermLevel = 'NONE' | 'READ' | 'WRITE';
export type ProcessPermLevel = 'NONE' | 'READ';

export type PermLevel =
  | CubePermLevel | DimPermLevel | HierPermLevel | ElementPermLevel | ProcessPermLevel;
