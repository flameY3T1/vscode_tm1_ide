import { encodeODataKey } from '../../utils/odataKey';

/** Pre-encoded }Groups dimension token, matching the existing working REST call. */
export const GROUPS_DIM_TOKEN = '%7DGroups';

/**
 * Build the POST /Cubes body for a (possibly slimmed) cell-security cube.
 * Selected dims are kept in source-cube order; }Groups is appended last.
 * Throws if no source dimension is selected (TM1 needs >= 2 dims incl. }Groups).
 */
export function buildCellSecurityCubeBody(
  cubeName: string,
  sourceDimsInOrder: string[],
  selected: string[],
): string {
  const sel = new Set(selected);
  const chosen = sourceDimsInOrder.filter((d) => sel.has(d));
  if (chosen.length === 0) {
    throw new Error('At least one dimension must be selected');
  }
  // `Dimensions@odata.bind` values are RESOURCE PATHS (URI references), not OData
  // literals — names need quote-doubling AND URL-encoding (`encodeODataKey`).
  // GROUPS_DIM_TOKEN is already pre-encoded and must NOT run through it again.
  const binds = [
    ...chosen.map((d) => `Dimensions('${encodeODataKey(d)}')`),
    `Dimensions('${GROUPS_DIM_TOKEN}')`,
  ];
  return JSON.stringify({ Name: `}CellSecurity_${cubeName}`, 'Dimensions@odata.bind': binds });
}
