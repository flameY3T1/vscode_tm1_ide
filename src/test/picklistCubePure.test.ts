import { describe, it, expect } from 'vitest';
import {
  PICKLIST_DIM,
  picklistCubeName,
  basecubeOfPicklistCube,
  indexPicklistCubes,
  buildPicklistCubeBody,
  buildPicklistDimensionBody,
} from '../providers/picklistCubePure';

describe('picklistCubeName / basecubeOfPicklistCube', () => {
  it('prefixes the base cube', () => {
    expect(picklistCubeName('Umsatz')).toBe('}PickList_Umsatz');
  });

  it('reverses the prefix', () => {
    expect(basecubeOfPicklistCube('}PickList_Umsatz')).toBe('Umsatz');
  });

  it('matches the prefix case-insensitively but keeps the base cube casing', () => {
    // TM1 compares object names case-insensitively; a cube created via REST
    // can be called `}Picklist_`, while the server writes `}PickList_`.
    expect(basecubeOfPicklistCube('}picklist_UmSatz')).toBe('UmSatz');
  });

  it('returns undefined for anything else', () => {
    expect(basecubeOfPicklistCube('Umsatz')).toBeUndefined();
    expect(basecubeOfPicklistCube('}ElementAttributes_Umsatz')).toBeUndefined();
    expect(basecubeOfPicklistCube('')).toBeUndefined();
  });
});

describe('indexPicklistCubes', () => {
  it('collects base cube names in lower case', () => {
    const set = indexPicklistCubes(['Umsatz', '}PickList_Umsatz', 'Kosten', '}Clients']);
    expect([...set]).toEqual(['umsatz']);
  });

  it('is empty when no picklist cube exists', () => {
    expect(indexPicklistCubes(['Umsatz', 'Kosten']).size).toBe(0);
  });

  it('does not treat a picklist cube as a base cube of its own', () => {
    // `}PickList_}PickList_X` does not exist — but the index must also not
    // infer from `}PickList_Umsatz` that `}PickList_Umsatz` itself has one.
    const set = indexPicklistCubes(['}PickList_Umsatz']);
    expect(set.has('}picklist_umsatz')).toBe(false);
    expect(set.has('umsatz')).toBe(true);
  });
});

describe('buildPicklistCubeBody', () => {
  it('appends the control dimension last and keeps storage order', () => {
    const body = buildPicklistCubeBody('Umsatz', ['Jahre', 'Regionen', 'ValueFields']);
    expect(body.Name).toBe('}PickList_Umsatz');
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('Jahre')",
      "Dimensions('Regionen')",
      "Dimensions('ValueFields')",
      "Dimensions('%7DPickList')",
    ]);
  });

  it('escapes OData keys in dimension names', () => {
    const body = buildPicklistCubeBody('C', ["Di'm"]);
    expect(body['Dimensions@odata.bind'][0]).toBe("Dimensions('Di''m')");
  });

  it('throws when the cube reports no dimensions', () => {
    // An empty dimension list would come from a silent read error; a cube
    // with only `}PickList` would be invalid for TM1 anyway (400 Code 14).
    expect(() => buildPicklistCubeBody('Umsatz', [])).toThrow(/no dimensions/);
  });
});

describe('buildPicklistDimensionBody', () => {
  it('creates one String element named Value', () => {
    const body = buildPicklistDimensionBody() as any;
    expect(body.Name).toBe(PICKLIST_DIM);
    expect(body.Hierarchies[0].Name).toBe(PICKLIST_DIM);
    expect(body.Hierarchies[0].Elements).toEqual([{ Name: 'Value', Type: 'String' }]);
  });
});
