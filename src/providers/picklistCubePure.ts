// src/providers/picklistCubePure.ts
// Naming rules and request bodies for the picklist control cube.
// vscode-free (`pure-no-vscode`, depcruise) — the commands in
// `picklistCube.ts` pass in plain data.
//
// TM1 has no dedicated REST resource for picklists: a cube named
// `}PickList_<Cube>` with the base cube's dimensions plus `}PickList`
// (exactly one string element `Value`) IS the definition. Verified live on
// 2026-08-14 against 11.8 (picklistProbe13.js).
import { encodeODataKey } from '../utils/odataKey';

/** The control dimension that makes the picklist cube into one. */
export const PICKLIST_DIM = '}PickList';

/** The single element of the control dimension. String, not numeric. */
export const PICKLIST_DIM_ELEMENT = 'Value';

const PICKLIST_CUBE_PREFIX = '}PickList_';

/** `Sales` → `}PickList_Sales`. */
export function picklistCubeName(cubeName: string): string {
  return `${PICKLIST_CUBE_PREFIX}${cubeName}`;
}

/**
 * The base cube's name from a control cube's name, otherwise `undefined`.
 * The comparison is case-insensitive because TM1 compares object names
 * that way — the server writes `}PickList_`, while a cube created via
 * REST could be named `}Picklist_`.
 */
export function basecubeOfPicklistCube(name: string): string | undefined {
  const p = PICKLIST_CUBE_PREFIX.toLowerCase();
  return name.toLowerCase().startsWith(p) ? name.slice(PICKLIST_CUBE_PREFIX.length) : undefined;
}

/**
 * From the full cube list, the set of base cubes that already have a
 * picklist cube — lowercased, because the comparison is too.
 *
 * Uses the list the tree fetches anyway: no extra query per node, just so
 * the context menu shows the right entry.
 */
export function indexPicklistCubes(allCubeNames: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const n of allCubeNames) {
    const base = basecubeOfPicklistCube(n);
    if (base) { out.add(base.toLowerCase()); }
  }
  return out;
}

/**
 * `POST /Cubes` body: the base cube's dimensions in unchanged order, with
 * `}PickList` last.
 *
 * The order is not cosmetic — the control cube cellset's ordinals must
 * match those of the data cellset, or the Cube Viewer shows the picklist
 * on the wrong cell.
 */
export function buildPicklistCubeBody(
  cubeName: string,
  baseDims: readonly string[],
): { Name: string; 'Dimensions@odata.bind': string[] } {
  if (baseDims.length === 0) {
    throw new Error(`Cube "${cubeName}" reports no dimensions`);
  }
  const dims = [...baseDims, PICKLIST_DIM];
  return {
    Name: picklistCubeName(cubeName),
    'Dimensions@odata.bind': dims.map(d => `Dimensions('${encodeODataKey(d)}')`),
  };
}

/** `POST /Dimensions` body for the control dimension itself. */
export function buildPicklistDimensionBody(): Record<string, unknown> {
  return {
    Name: PICKLIST_DIM,
    Hierarchies: [{
      Name: PICKLIST_DIM,
      Elements: [{ Name: PICKLIST_DIM_ELEMENT, Type: 'String' }],
    }],
  };
}
