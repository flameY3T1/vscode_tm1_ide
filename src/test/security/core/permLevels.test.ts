// src/test/security/core/permLevels.test.ts
import { describe, it, expect } from 'vitest';
import { LEVELS_PER_RESOURCE } from '../../../security/core/permLevels';

describe('permLevels', () => {
  it('LEVELS_PER_RESOURCE pro ResourceType korrekt', () => {
    expect(LEVELS_PER_RESOURCE.cube).toEqual(['NONE','READ','WRITE','RESERVE','LOCK','ADMIN']);
    expect(LEVELS_PER_RESOURCE.dimension).toEqual(['NONE','READ','WRITE','ADMIN']);
    expect(LEVELS_PER_RESOURCE.hierarchy).toEqual(['NONE','READ','WRITE','ADMIN']);
    expect(LEVELS_PER_RESOURCE.element).toEqual(['NONE','READ','WRITE']);
    expect(LEVELS_PER_RESOURCE.process).toEqual(['NONE','READ']);
  });
});
