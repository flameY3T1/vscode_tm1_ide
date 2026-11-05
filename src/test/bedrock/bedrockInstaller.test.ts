import { describe, it, expect, vi } from 'vitest';
import { installBedrockManifest } from '../../bedrock/bedrockInstaller';

describe('installBedrockManifest', () => {
  it('calls deploy per entry with progress callbacks', async () => {
    const manifest = [
      { name: 'bedrock.a', payload: { PrologProcedure: 'a' } as any },
      { name: 'bedrock.b', payload: { PrologProcedure: 'b' } as any },
    ];
    const deploy = vi.fn().mockResolvedValue(undefined);
    const progress: Array<{ done: number; total: number; current: string }> = [];
    const result = await installBedrockManifest(undefined as any, manifest, deploy, p => progress.push(p));
    expect(deploy).toHaveBeenCalledTimes(2);
    expect(result.installed).toBe(2);
    expect(result.failed).toEqual([]);
    expect(progress[1]).toMatchObject({ done: 2, total: 2, current: 'bedrock.b' });
  });

  it('collects failures without aborting', async () => {
    const manifest = [
      { name: 'bedrock.a', payload: {} as any },
      { name: 'bedrock.b', payload: {} as any },
    ];
    const deploy = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    const result = await installBedrockManifest(undefined as any, manifest, deploy, () => {});
    expect(result.installed).toBe(1);
    expect(result.failed).toEqual([{ name: 'bedrock.b', error: 'boom' }]);
  });
});
