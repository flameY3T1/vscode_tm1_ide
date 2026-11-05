import { describe, expect, it } from 'vitest';
import {
  sandboxCommitPath,
  sandboxKey,
} from '../tm1Rest/sandboxApi';

describe('sandboxApi URL builders', () => {
  describe('sandboxKey', () => {
    it('wraps name in OData entity-key syntax', () => {
      expect(sandboxKey('MyBox')).toBe("Sandboxes('MyBox')");
    });

    it('escapes single quotes', () => {
      expect(sandboxKey("a'b")).toBe("Sandboxes('a''b')");
    });

    it('URL-encodes characters that would end the path (review 2026-10-03, A4)', () => {
      expect(sandboxKey('Q1 #2?')).toBe("Sandboxes('Q1%20%232%3F')");
    });
  });

  describe('sandboxCommitPath', () => {
    it('appends tm1.Commit action segment', () => {
      expect(sandboxCommitPath('MyBox')).toBe("Sandboxes('MyBox')/tm1.Commit");
    });

    it('escapes single quotes in the key', () => {
      expect(sandboxCommitPath("a'b")).toBe("Sandboxes('a''b')/tm1.Commit");
    });
  });
});
