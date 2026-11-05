import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from '../../git/sanitize';

describe('sanitize', () => {
  describe('sanitizeFilename', () => {
    it('passes plain ASCII names through', () => {
      expect(sanitizeFilename('MyProcess')).toBe('MyProcess');
    });

    it('preserves spaces, dashes, underscores, dots', () => {
      expect(sanitizeFilename('My Process_v1.2-final')).toBe('My Process_v1.2-final');
    });

    it('preserves umlauts', () => {
      expect(sanitizeFilename('Größe')).toBe('Größe');
    });

    it('replaces forward slashes with underscore', () => {
      expect(sanitizeFilename('foo/bar')).toBe('foo_bar');
    });

    it('replaces backslashes with underscore', () => {
      expect(sanitizeFilename('foo\\bar')).toBe('foo_bar');
    });

    it('replaces colon (Windows reserved) with underscore', () => {
      expect(sanitizeFilename('a:b')).toBe('a_b');
    });

    it('replaces other Windows-illegal chars (* ? " < > |)', () => {
      expect(sanitizeFilename('a*b?c"d<e>f|g')).toBe('a_b_c_d_e_f_g');
    });

    it('suffixes Windows-reserved device names', () => {
      expect(sanitizeFilename('CON')).toBe('CON_');
      expect(sanitizeFilename('PRN')).toBe('PRN_');
      expect(sanitizeFilename('AUX')).toBe('AUX_');
      expect(sanitizeFilename('NUL')).toBe('NUL_');
      expect(sanitizeFilename('COM1')).toBe('COM1_');
      expect(sanitizeFilename('LPT9')).toBe('LPT9_');
    });

    it('reserved-name detection is case-insensitive', () => {
      expect(sanitizeFilename('con')).toBe('con_');
      expect(sanitizeFilename('Aux')).toBe('Aux_');
    });

    it('does not suffix names that contain reserved as substring', () => {
      expect(sanitizeFilename('CONTROL')).toBe('CONTROL');
      expect(sanitizeFilename('PRINTING')).toBe('PRINTING');
    });
  });
});
