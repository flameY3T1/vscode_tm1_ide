import { describe, it, expect } from 'vitest';
import { resolveServerDir, expandRepoPath } from '../../git/gitConfig';

describe('gitConfig', () => {
  describe('expandRepoPath', () => {
    it('substitutes ${workspaceFolder}', () => {
      expect(expandRepoPath('${workspaceFolder}/tm1', '/home/u/proj')).toBe('/home/u/proj/tm1');
    });

    it('returns path unchanged if no placeholder', () => {
      expect(expandRepoPath('/abs/path', '/home/u/proj')).toBe('/abs/path');
    });

    it('handles trailing slash in template', () => {
      expect(expandRepoPath('${workspaceFolder}/', '/root')).toBe('/root/');
    });
  });

  describe('resolveServerDir', () => {
    it('joins repoPath + sanitized serverName', () => {
      expect(resolveServerDir('/tm1', 'prod')).toBe('/tm1/prod');
    });

    it('sanitizes server name with slashes', () => {
      expect(resolveServerDir('/tm1', 'a/b')).toBe('/tm1/a_b');
    });

    it('handles reserved windows name', () => {
      expect(resolveServerDir('/tm1', 'CON')).toBe('/tm1/CON_');
    });
  });
});
