/**
 * Pure JSON loader for TI signature data.
 *
 * Source: `media/tiSignatures.json` (emitted by `scripts/build-signatures.cjs`).
 * Format:  { version: number, count: number, signatures: [[key, TiKnownSignature], ...] }
 *
 * `maxParams === Infinity` is serialized as the string sentinel `"__INFINITY__"`
 * because JSON has no numeric Infinity. This module rehydrates it back to JS Infinity.
 *
 * Phase 2 of the JSON-asset split (see plan 2026-05-24-tisignatures-json-asset-split.md).
 * No vscode imports — usable in extension host, webviews, and tests.
 */
import type { TiKnownSignature } from './tiSignatures';

export const INFINITY_SENTINEL = '__INFINITY__';
export const CURRENT_SCHEMA_VERSION = 1;

export interface TiSignaturesJson {
  version: number;
  count: number;
  signatures: ReadonlyArray<readonly [string, TiKnownSignature]>;
}

export class TiSignaturesLoadError extends Error {}

/** Rehydrate `"__INFINITY__"` sentinel to JS `Infinity` in a single signature object. */
export function rehydrateSignature(sig: TiKnownSignature): TiKnownSignature {
  if ((sig.maxParams as unknown) === INFINITY_SENTINEL) {
    return { ...sig, maxParams: Infinity };
  }
  return sig;
}

/** Parse JSON text, validate shape + version, rehydrate Infinity sentinels. */
export function parseSignaturesJson(text: string): ReadonlyArray<readonly [string, TiKnownSignature]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new TiSignaturesLoadError(`Invalid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new TiSignaturesLoadError('Expected object at root');
  }
  const payload = parsed as Partial<TiSignaturesJson>;
  if (payload.version !== CURRENT_SCHEMA_VERSION) {
    throw new TiSignaturesLoadError(
      `Unsupported schema version: got ${payload.version}, expected ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(payload.signatures)) {
    throw new TiSignaturesLoadError('Missing or invalid `signatures` array');
  }
  return payload.signatures.map(([key, sig]) => [key, rehydrateSignature(sig)] as const);
}
