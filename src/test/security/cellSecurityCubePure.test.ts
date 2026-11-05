import { describe, it, expect } from 'vitest';
import { buildCellSecurityCubeBody, GROUPS_DIM_TOKEN } from '../../commands/security/cellSecurityCubePure';

describe('buildCellSecurityCubeBody', () => {
  it('keeps selected dims in source-cube order and appends }Groups last', () => {
    const body = JSON.parse(
      buildCellSecurityCubeBody('Sales', ['Region', 'Time', 'Product', 'Measure'], ['Product', 'Region']),
    );
    expect(body.Name).toBe('}CellSecurity_Sales');
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('Region')",
      "Dimensions('Product')",
      `Dimensions('${GROUPS_DIM_TOKEN}')`,
    ]);
  });

  it('uses the pre-encoded }Groups token', () => {
    expect(GROUPS_DIM_TOKEN).toBe('%7DGroups');
  });

  it("escapes single quotes in dim names ('->'')", () => {
    const body = JSON.parse(buildCellSecurityCubeBody('C', ["O'Brien"], ["O'Brien"]));
    expect(body['Dimensions@odata.bind'][0]).toBe("Dimensions('O''Brien')");
  });

  it('URL-encodes reserved chars and does NOT double-encode }Groups', () => {
    const dim = "A/B#C?D'E F";
    const body = JSON.parse(buildCellSecurityCubeBody('C', [dim], [dim]));
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('A%2FB%23C%3FD''E%20F')",
      "Dimensions('%7DGroups')",
    ]);
    // Guard: %7D must not become %257D
    expect(body['Dimensions@odata.bind'][1]).not.toContain('%257D');
  });

  it('leaves Name raw — it is a property value, not a resource path', () => {
    const body = JSON.parse(buildCellSecurityCubeBody("A/B#C?D'E F", ['R'], ['R']));
    expect(body.Name).toBe("}CellSecurity_A/B#C?D'E F");
  });

  it('throws when no dimension is selected', () => {
    expect(() => buildCellSecurityCubeBody('Sales', ['Region'], [])).toThrow();
  });

  it('ignores selected names not in the source cube', () => {
    const body = JSON.parse(buildCellSecurityCubeBody('Sales', ['Region', 'Time'], ['Region', 'Ghost']));
    expect(body['Dimensions@odata.bind']).toEqual([
      "Dimensions('Region')",
      `Dimensions('${GROUPS_DIM_TOKEN}')`,
    ]);
  });
});
