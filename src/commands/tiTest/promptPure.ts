/**
 * Pure (vscode-free) validation for the test-name prompt in `prompt.ts`. All
 * the rules live here, the prompt layer just feeds user input in. That way the rules are testable without a
 * `vscode` mock.
 */

export function validateTestName(input: string | undefined, siblings: string[]): string | undefined {
  const n = (input ?? '').trim();
  if (!n) return 'Name must not be empty.';
  if (/[\\/]/.test(n)) return 'Slash/backslash not allowed.';
  if (n === '.' || n === '..') return 'Invalid name.';
  if (siblings.some((s) => s.toLowerCase() === n.toLowerCase())) {
    return `Test "${n}" already exists in this folder.`;
  }
  return undefined;
}
