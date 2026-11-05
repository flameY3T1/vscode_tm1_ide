import { describe, it, expect } from 'vitest';
import { RULES_FUNCTION_KEYS } from '../webviewClient/ruleEditorMonaco/completions';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

/**
 * The rule editor offers functions from an ALLOWLIST, while the TI editor uses a
 * denylist (`!sig.rulesOnly`). New signatures therefore appear in TI automatically
 * but stay invisible in rules until someone remembers this set — which is exactly
 * how ROUNDP went missing.
 *
 * Two failure modes, both silent before these tests:
 *   - a key with no signature behind it produces no completion at all
 *   - a rule-valid function that nobody added stays unreachable
 *
 * Validity is per IBM's own wording ("valid in both rules and TurboIntegrator
 * processes"), checked against the docs on 2026-08-07.
 */

describe('rule editor function allowlist', () => {
  it('every allowlisted key has a signature behind it', () => {
    const dead = [...RULES_FUNCTION_KEYS].filter((k) => !KNOWN_SIGNATURES.has(k));
    expect(dead).toEqual([]);
  });

  it('offers the arithmetic functions that IBM documents as rule-valid', () => {
    for (const fn of ['roundp', 'int', 'round', 'abs', 'mod', 'max', 'min', 'sqrt']) {
      expect(RULES_FUNCTION_KEYS.has(fn), `${fn} missing from the rules allowlist`).toBe(true);
    }
  });

  it('offers the element/dimension helpers that IBM documents as rule-valid', () => {
    for (const fn of ['elementcount', 'elementattrn', 'elementattrs', 'levelcount', 'tabdim']) {
      expect(RULES_FUNCTION_KEYS.has(fn), `${fn} missing from the rules allowlist`).toBe(true);
    }
  });

  it('offers CODEW alongside CODE', () => {
    expect(RULES_FUNCTION_KEYS.has('codew')).toBe(true);
  });

  it('does NOT offer functions IBM documents as TurboIntegrator-only', () => {
    // Each of these carries "valid in TM1 TurboIntegrator processes only".
    for (const fn of ['stringtonumberex', 'formatdate', 'parsedate']) {
      expect(RULES_FUNCTION_KEYS.has(fn), `${fn} is TI-only and must not be offered in rules`).toBe(false);
    }
  });

  it('never offers a rules-only function to the TI editor', () => {
    // The mirror-image contract, so the two lists cannot both drift the same way.
    for (const [key, sig] of KNOWN_SIGNATURES) {
      if (sig.rulesOnly) {
        expect(RULES_FUNCTION_KEYS.has(key), `${sig.name} is rulesOnly but not offered in rules`).toBe(true);
      }
    }
  });
});
