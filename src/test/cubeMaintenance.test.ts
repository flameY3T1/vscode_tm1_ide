import { describe, it, expect } from 'vitest';
import { buildCubeMaintUrl, labelForAction } from '../cubeMaintenance/cubeMaintenance';

describe('buildCubeMaintUrl', () => {
  it('builds SaveData URL', () => {
    expect(buildCubeMaintUrl('Sales', 'SaveData')).toBe(`Cubes('Sales')/tm1.SaveData`);
  });
  it('builds Unload URL', () => {
    expect(buildCubeMaintUrl('Sales', 'Unload')).toBe(`Cubes('Sales')/tm1.Unload`);
  });
  it('builds Load URL', () => {
    expect(buildCubeMaintUrl('Sales', 'Load')).toBe(`Cubes('Sales')/tm1.Load`);
  });
  it('escapes single quote in cube name (OData key escape)', () => {
    expect(buildCubeMaintUrl(`O'Brien`, 'SaveData')).toBe(`Cubes('O''Brien')/tm1.SaveData`);
  });
  it('encodes special URI chars', () => {
    expect(buildCubeMaintUrl('Sales/EU', 'Unload')).toBe(`Cubes('Sales%2FEU')/tm1.Unload`);
  });
});

describe('labelForAction', () => {
  it('returns English source labels', () => {
    expect(labelForAction('SaveData')).toBe('Save cube data');
    expect(labelForAction('Unload')).toBe('Unload cube');
    expect(labelForAction('Load')).toBe('Load cube');
  });
});
