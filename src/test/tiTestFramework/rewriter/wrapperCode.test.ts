import { describe, it, expect } from 'vitest';
import {
  LOG_FILE_VAR,
} from '../../../tiTestFramework/rewriter/wrapperCode';

describe('wrapperCode', () => {
  describe('buildSectionOpen', () => {

    it('uses LOG_FILE_VAR consistently', () => {
      expect(LOG_FILE_VAR).toBe('sLogFile');
    });
  });
});
