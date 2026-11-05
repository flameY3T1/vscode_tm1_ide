import { describe, it, expect } from 'vitest';
import { maskLine } from '../tiLogicVisualizer/tiLinter/helpers/maskCode';

describe('maskLine', () => {
  it('keeps code identifiers, blanks string contents', () => {
    expect(maskLine("vX = 'vY';")).toContain('vX');
    expect(maskLine("vX = 'vY';")).not.toContain('vY');
  });
  it('drops the # comment tail', () => {
    expect(maskLine('vA = 1; # vC note')).toContain('vA');
    expect(maskLine('vA = 1; # vC note')).not.toContain('vC');
  });
  it('blanks identifiers inside [...] refs', () => {
    expect(maskLine("vA = DB('C', [vBr]);")).toContain('vA');
    expect(maskLine("vA = DB('C', [vBr]);")).not.toContain('vBr');
  });
});
