import { describe, it, expect } from 'vitest';
import {
  validatePassword, validateUserName, validateGroupName,
} from '../../../security/core/userValidators';

describe('userValidators', () => {
  it('PW < 8 → error', () => expect(validatePassword('short').ok).toBe(false));
  it('PW >= 8 → ok', () => expect(validatePassword('long-enough').ok).toBe(true));
  it('PW empty → error', () => expect(validatePassword('').ok).toBe(false));

  it('UserName valid', () => expect(validateUserName('sales_01').ok).toBe(true));
  it('UserName with spaces', () => expect(validateUserName('sales 01').ok).toBe(false));
  it('UserName empty', () => expect(validateUserName('').ok).toBe(false));
  it('UserName Sonderzeichen', () => expect(validateUserName('sales@01').ok).toBe(false));

  it('GroupName valid', () => expect(validateGroupName('Sales', []).ok).toBe(true));
  it('GroupName collision case-insensitive', () => expect(validateGroupName('SALES', ['Sales']).ok).toBe(false));
  it('GroupName empty', () => expect(validateGroupName('', []).ok).toBe(false));
});
