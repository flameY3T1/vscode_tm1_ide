import { describe, it, expect, vi } from 'vitest';
import { fetchLatestBedrockRelease, bedrockEditionFor, bedrockReleasesUrl } from '../../bedrock/bedrockRelease';

describe('bedrockEditionFor', () => {
  it('picks Bedrock 4 for TM1 11.x and Bedrock 5 for TM1 Database 12', () => {
    expect(bedrockEditionFor({ version: 'v11' })).toBe('v4');
    expect(bedrockEditionFor({})).toBe('v4');
    expect(bedrockEditionFor({ version: 'v12' })).toBe('v5');
  });
});

describe('fetchLatestBedrockRelease', () => {
  it('returns tag + zipball URL from injected fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ tag_name: 'v4.1.4', zipball_url: 'https://api.github.com/repos/cubewise-code/bedrock/zipball/v4.1.4' });
    const rel = await fetchLatestBedrockRelease(fetcher);
    expect(rel.tag).toBe('v4.1.4');
    expect(rel.zipballUrl).toContain('zipball/v4.1.4');
    expect(rel.edition).toBe('v4');
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/cubewise-code/bedrock/releases/latest');
  });

  it('asks the bedrock-5 repo for the v5 edition', async () => {
    // Otherwise the v11 library ends up on a v12 database.
    const fetcher = vi.fn().mockResolvedValue({ tag_name: 'v5.4.0', zipball_url: 'https://api.github.com/repos/cubewise-code/bedrock-5/zipball/v5.4.0' });
    const rel = await fetchLatestBedrockRelease(fetcher, 'v5');
    expect(rel.edition).toBe('v5');
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/cubewise-code/bedrock-5/releases/latest');
  });

  it('throws on missing fields', async () => {
    const fetcher = vi.fn().mockResolvedValue({});
    await expect(fetchLatestBedrockRelease(fetcher)).rejects.toThrow(/tag/);
  });

  it('never points both editions at the same repo', () => {
    expect(bedrockReleasesUrl('v4')).not.toBe(bedrockReleasesUrl('v5'));
  });
});
