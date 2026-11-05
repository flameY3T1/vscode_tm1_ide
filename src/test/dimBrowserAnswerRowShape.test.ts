import { describe, it, expect } from 'vitest';
import type { AnswerRow as ApiAnswerRow, AncestorRef } from '../tm1Rest/dimensionSetQueryPure';
import type { AnswerRow as ClientAnswerRow } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import type { ViewAnswerRow } from '../webviewClient/dimensionBrowser/protocol';
import type { FilterCandidate } from '../webviewClient/dimensionBrowser/filterPredicate';

/**
 * `AnswerRow` exists THREE times: as the original in `tm1Rest/dimensionElementsApi.ts`,
 * as a field-identical copy in `webviewClient/dimensionBrowser/rowsFromAnswer.ts`
 * and once more as `ViewAnswerRow` in `webviewClient/dimensionBrowser/protocol.ts`
 * (the host→webview message shape) — the layer rule `webview-no-tm1rest`
 * (`.dependency-cruiser.js`) forbids `webviewClient/` to import from
 * `tm1Rest/`, which is why neither of the two copies can be replaced by a re-export.
 * If one version drifts away (new field, different optionality,
 * different union variant), nobody notices, as long as only the one side
 * compiles and runs.
 *
 * Form of proof: a compile-time proof via mutual assignability (like
 * `tm1Rest/transport/authAssertions.ts`), not a source scan (like
 * `noManualBodyRelease.test.ts`) — a structurally deviating field is
 * a real type error here, and the compiler finds it more precisely than a regex
 * (which would not even see e.g. a changed union variant like `'N'|'C'` instead of `'N'|'C'|'S'`
 * at all). `src/test/tsconfig.json` covers both `tm1Rest/`
 * and `webviewClient/` (`lib: DOM` set there specifically for that) — if
 * one side drifts, `npm run typecheck` breaks at the functions below.
 *
 * What the guard catches: an additional REQUIRED field on one side, a
 * rename, a narrowed union, a field that became optional on one side only.
 * What it does NOT catch: an additional OPTIONAL field on only one side —
 * TypeScript does not check excess properties on variable assignment.
 * As long as `AnswerRow` has no optional field, that is without consequence; whoever
 * introduces one must extend the guard.
 *
 * ⚠ WITHOUT `npm run typecheck` THIS FILE IS WORTHLESS. The proof is the
 * function declarations below, and only the compiler checks those. The
 * `it()` assertions below are tautologies — they compare an object
 * with itself, because the assignment functions are the identity
 * at run time. `npx vitest run` therefore reports this file green even when the
 * three `AnswerRow` versions have drifted apart completely: vitest
 * transpiles (esbuild) and does NOT type-check. Whoever wants the guard duty here
 * must run `npm run typecheck`.
 */
const fromApiToClient = (row: ApiAnswerRow): ClientAnswerRow => row;
const fromClientToApi = (row: ClientAnswerRow): ApiAnswerRow => row;
// Third copy: `ViewAnswerRow` from `protocol.ts` (review finding I2 — the
// guard so far covered only two of the three copies).
const fromApiToView = (row: ApiAnswerRow): ViewAnswerRow => row;
const fromViewToApi = (row: ViewAnswerRow): ApiAnswerRow => row;
// `matchesLayer` in `filterPredicate.ts` processes `FilterCandidate`;
// `AncestorRef` is meant directly for that. Fewer fields than `AnswerRow` —
// without this proof a drift is possible that breaks the indentation.
const fromAncestorToFilter = (anc: AncestorRef): FilterCandidate => anc;
const fromFilterToAncestor = (cand: FilterCandidate): AncestorRef => cand;

describe('AnswerRow shape equality (tm1Rest original vs. webviewClient copies)', () => {
  it('is assignable in both directions (compile proof, see comment above)', () => {
    // The actual proof is the four/six function declarations above — they
    // only compile if all shapes are structurally identical. This
    // run-time assertion only exists so that the file has a real `it()`
    // and the test runner does not report it as empty.
    const sample = { name: 'a', caption: 'a', type: 'N' as const, level: 0, parent: null, drilled: false, ancestors: [] };
    expect(fromApiToClient(sample)).toEqual(sample);
    expect(fromClientToApi(sample)).toEqual(sample);
    expect(fromApiToView(sample)).toEqual(sample);
    expect(fromViewToApi(sample)).toEqual(sample);
    // AncestorRef ↔ FilterCandidate compatibility — FilterCandidate is a
    // subset of the AnswerRow fields and `matchesLayer` processes AncestorRef
    // directly as a FilterCandidate.
    const ancestorSample = { name: 'a', type: 'N' as const, level: 0 };
    expect(fromAncestorToFilter(ancestorSample)).toEqual(ancestorSample);
    expect(fromFilterToAncestor(ancestorSample)).toEqual(ancestorSample);
  });
});
