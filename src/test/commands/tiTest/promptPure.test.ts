import { describe, it, expect } from 'vitest';
import { validateTestName } from '../../../commands/tiTest/promptPure';

describe('validateTestName', () => {
  it('rejects undefined as empty', () => {
    expect(validateTestName(undefined, [])).toBe('Name must not be empty.');
  });

  it('rejects empty string', () => {
    expect(validateTestName('', [])).toBe('Name must not be empty.');
  });

  it('rejects whitespace-only as empty (after trim)', () => {
    expect(validateTestName('   ', [])).toBe('Name must not be empty.');
  });

  it('rejects forward slash', () => {
    expect(validateTestName('a/b', [])).toBe('Slash/backslash not allowed.');
  });

  it('rejects backslash', () => {
    expect(validateTestName('a\\b', [])).toBe('Slash/backslash not allowed.');
  });

  it('rejects single dot', () => {
    expect(validateTestName('.', [])).toBe('Invalid name.');
  });

  it('rejects double dot', () => {
    expect(validateTestName('..', [])).toBe('Invalid name.');
  });

  it('rejects exact duplicate sibling', () => {
    expect(validateTestName('MyTest', ['Other', 'MyTest'])).toBe(
      'Test "MyTest" already exists in this folder.',
    );
  });

  it('rejects duplicate case-insensitively', () => {
    expect(validateTestName('mytest', ['MyTest'])).toBe(
      'Test "mytest" already exists in this folder.',
    );
  });

  it('accepts unique name', () => {
    expect(validateTestName('FreshOne', ['Other'])).toBeUndefined();
  });

  it('accepts trimmed unique name when surrounded by whitespace', () => {
    expect(validateTestName('  FreshOne  ', ['Other'])).toBeUndefined();
  });

  it('accepts unique name against empty siblings list', () => {
    expect(validateTestName('Anything', [])).toBeUndefined();
  });
});
