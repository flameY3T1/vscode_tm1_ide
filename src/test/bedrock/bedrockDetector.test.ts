import { describe, it, expect, vi } from 'vitest';
import { detectBedrock } from '../../bedrock/bedrockDetector';

describe('detectBedrock', () => {
  it('returns installed:false when probe finds none', async () => {
    const listFn = vi.fn().mockResolvedValue([]);
    const result = await detectBedrock(undefined as any, listFn);
    expect(result.installed).toBe(false);
    expect(result.count).toBe(0);
  });

  it('counts bedrock.* processes only', async () => {
    const listFn = vi.fn().mockResolvedValue([
      { Name: 'bedrock.cube.data.copy' },
      { Name: 'bedrock.dim.element.create' },
      { Name: 'MyOtherProcess' },
    ]);
    const result = await detectBedrock(undefined as any, listFn);
    expect(result.installed).toBe(true);
    expect(result.count).toBe(2);
  });
});
