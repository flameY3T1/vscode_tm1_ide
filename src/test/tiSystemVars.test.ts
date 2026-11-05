import { describe, it, expect } from 'vitest';
import { TI_SYSTEM_VARIABLES } from '../tiLogicVisualizer/tiSystemVars';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

describe('TI_SYSTEM_VARIABLES — single source for TI system variables', () => {
  it('contains the explicit cell-value pseudo vars', () => {
    expect(TI_SYSTEM_VARIABLES.has('nvalue')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('svalue')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('value_is_string')).toBe(true);
  });

  it('contains the global-context pseudo vars', () => {
    expect(TI_SYSTEM_VARIABLES.has('numericglobalcontext')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('stringglobalcontext')).toBe(true);
  });

  it('contains the minor-error control vars', () => {
    expect(TI_SYSTEM_VARIABLES.has('minorerrorlogmax')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('onminorerrordoitemskip')).toBe(true);
  });

  it('contains explicit datasource state vars not in signatures', () => {
    expect(TI_SYSTEM_VARIABLES.has('datasourceview')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourcesubset')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourcedimension')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourcecurrentrecordindex')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourcehierarchyname')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourceodbcusername')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourceodbcpassword')).toBe(true);
    expect(TI_SYSTEM_VARIABLES.has('datasourceodbcdsn')).toBe(true);
  });

  it('auto-derives every datasource* key from KNOWN_SIGNATURES', () => {
    const datasourceSigs = [...KNOWN_SIGNATURES.keys()].filter(k => k.startsWith('datasource'));
    expect(datasourceSigs.length).toBeGreaterThan(0);
    for (const k of datasourceSigs) {
      expect(TI_SYSTEM_VARIABLES.has(k)).toBe(true);
    }
  });

  it('all entries are lowercase', () => {
    for (const k of TI_SYSTEM_VARIABLES) {
      expect(k).toBe(k.toLowerCase());
    }
  });
});
