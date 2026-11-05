import { describe, expect, it } from 'vitest';
import {
  isReservedName,
  isValidIdentifier,
  validateRenameTarget,
  VALID_IDENTIFIER_RE,
  TI_RESERVED,
} from '../providers/tiRenameProviderPure';

const BUILTINS = new Set(['cellgetn', 'cellgets', 'cellputn', 'cellputs', 'subst', 'long']);

describe('tiRenameProviderPure', () => {
  describe('isReservedName', () => {
    it('flags TI control-flow keywords', () => {
      for (const kw of ['if', 'endif', 'while', 'end', 'for', 'next']) {
        expect(isReservedName(kw, BUILTINS)).toBe(true);
      }
    });

    it('flags process-control statements', () => {
      for (const kw of ['itemreject', 'itemskip', 'processabort', 'processerror']) {
        expect(isReservedName(kw, BUILTINS)).toBe(true);
      }
    });

    it('flags TI built-in functions', () => {
      expect(isReservedName('cellgetn', BUILTINS)).toBe(true);
      expect(isReservedName('subst', BUILTINS)).toBe(true);
    });

    it('does not flag user identifiers', () => {
      expect(isReservedName('myvar', BUILTINS)).toBe(false);
      expect(isReservedName('vsdimname', BUILTINS)).toBe(false);
    });

    it('is case-sensitive — caller must lowercase', () => {
      expect(isReservedName('IF', BUILTINS)).toBe(false);
      expect(isReservedName('IF'.toLowerCase(), BUILTINS)).toBe(true);
    });
  });

  describe('isValidIdentifier', () => {
    it('accepts plain ASCII identifiers', () => {
      expect(isValidIdentifier('myVar')).toBe(true);
      expect(isValidIdentifier('_underscore')).toBe(true);
      expect(isValidIdentifier('a1b2c3')).toBe(true);
    });

    it('accepts German umlauts in identifiers', () => {
      expect(isValidIdentifier('müller')).toBe(true);
      expect(isValidIdentifier('Größe')).toBe(true);
      expect(isValidIdentifier('Cost_Accounts')).toBe(true);
    });

    it('rejects empty + leading digits + special chars', () => {
      expect(isValidIdentifier('')).toBe(false);
      expect(isValidIdentifier('1abc')).toBe(false);
      expect(isValidIdentifier('a-b')).toBe(false);
      expect(isValidIdentifier('a b')).toBe(false);
      expect(isValidIdentifier('hello!')).toBe(false);
    });
  });

  describe('validateRenameTarget', () => {
    it('returns null when both old and new are valid user names', () => {
      expect(validateRenameTarget('oldVar', 'newVar', BUILTINS)).toBeNull();
    });

    it('rejects renaming a reserved keyword', () => {
      const result = validateRenameTarget('if', 'newName', BUILTINS);
      expect(result).toContain('Built-in');
    });

    it('rejects renaming a built-in function', () => {
      const result = validateRenameTarget('CellGetN', 'newName', BUILTINS);
      expect(result).toContain('Built-in');
    });

    it('rejects empty new name', () => {
      const result = validateRenameTarget('old', '   ', BUILTINS);
      expect(result).toContain('empty');
    });

    it('rejects invalid identifier shape', () => {
      const result = validateRenameTarget('old', '1bad', BUILTINS);
      expect(result).toContain('Invalid');
    });

    it('rejects rename to a reserved keyword', () => {
      const result = validateRenameTarget('old', 'while', BUILTINS);
      expect(result).toContain('collides');
    });

    it('rejects rename to a built-in', () => {
      const result = validateRenameTarget('old', 'CellPutN', BUILTINS);
      expect(result).toContain('collides');
    });

    it('trims whitespace around new name before validation', () => {
      expect(validateRenameTarget('old', '  goodName  ', BUILTINS)).toBeNull();
    });
  });

  describe('exports', () => {
    it('TI_RESERVED is a non-empty readonly Set', () => {
      expect(TI_RESERVED.size).toBeGreaterThan(10);
      expect(TI_RESERVED.has('if')).toBe(true);
    });

    it('VALID_IDENTIFIER_RE rejects empty string', () => {
      expect(VALID_IDENTIFIER_RE.test('')).toBe(false);
    });
  });
});
