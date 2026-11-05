// src/tm1Rest/parseRest.ts
// Safe JSON-body parsers for TM1 REST responses.
//
// Wire-level reality: a successful 2xx response is *usually* well-formed
// OData JSON, but TM1 occasionally returns HTML error pages, empty bodies,
// or truncated responses on overloaded servers. A bare `JSON.parse(res.body)`
// at every call-site throws SyntaxError in those cases — and most callers
// do not catch it, so a transient server hiccup surfaces as an "Unexpected
// token <" stack trace instead of an empty-list fallback.
//
// These helpers swallow parse failures and return a safe shape, leaving
// HTTP-status-based error handling as the single check call-sites have to
// perform.

import type { ODataError } from './odataTypes';

/**
 * Extract the human-readable message from a parsed `ODataError` envelope,
 * uniformly across the two shapes TM1 REST uses for `error.message`: a
 * plain string, or `{ value: string }`. Returns `undefined` when neither
 * shape is present (caller keeps its own fallback text).
 */
export function odataErrorMessage(e: ODataError): string | undefined {
  const m = e.error?.message;
  if (typeof m === 'string') return m;
  if (m && typeof m.value === 'string') return m.value;
  return undefined;
}

/**
 * The readable reason inside a failed response body: the OData error message
 * (either shape), else a top-level `Message`, else the raw body. The connect
 * paths each parsed this inline with `j.error?.message`, which printed
 * "[object Object]" for the `{ value }` shape (review 2026-10-03, A9).
 */
export function errorBodyDetail(body: string): string {
  try {
    const j = JSON.parse(body) as ODataError & { Message?: unknown };
    return odataErrorMessage(j) ?? (typeof j.Message === 'string' ? j.Message : body);
  } catch { return body; }
}

/** Standard OData v4 collection envelope. */
export interface ODataValueEnvelope<T> {
  value?: T[];
  '@odata.context'?: string;
  '@odata.count'?: number;
}

/**
 * Parse an OData `value`-array response. Returns an empty envelope on parse
 * failure — callers can safely chain `.value ?? []`.
 */
export function parseEnvelope<T>(body: string): ODataValueEnvelope<T> {
  try {
    return JSON.parse(body) as ODataValueEnvelope<T>;
  } catch {
    return {};
  }
}

/**
 * Parse an OData `value`-array response and unwrap to the array directly,
 * with empty-array fallback on parse failure or missing `value`.
 */
export function parseODataValue<T>(body: string): T[] {
  return parseEnvelope<T>(body).value ?? [];
}

/**
 * Generic safe parse for non-envelope shapes (e.g. single-object responses).
 * Returns `fallback` on parse failure.
 */
export function parseJsonSafe<T>(body: string, fallback: T): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    return fallback;
  }
}

/**
 * STRICT parse + release. Mirrors the current raw `JSON.parse(res.body)` call
 * sites (e.g. cellset.ts) that immediately null out `res.body` on the next
 * line to let V8 collect the (potentially 10+ MB) raw string before the
 * caller walks the parsed structure.
 *
 * Throws on invalid JSON — this is NOT the safe variant (`parseJsonSafe`
 * above). The body is released only *after* a successful parse; a throw
 * leaves `res.body` intact so the caller's own catch block still sees it.
 *
 * Takes a structural `{ body: string }` — compatible with `ApiResponse`
 * (`src/tm1Rest/transport/types.ts`) without requiring an import.
 */
export function parseBody<T>(res: { body: string }): T {
  const parsed = JSON.parse(res.body) as T;
  (res as { body?: string }).body = '';
  return parsed;
}

/**
 * TOLERANT parse + release. The safe counterpart to `parseBody`: mirrors call
 * sites that use `parseJsonSafe`/`parseODataValue` (swallow bad JSON, return a
 * fallback) but still want the body released so V8 can collect the raw string
 * before the caller walks the parsed structure.
 *
 * Unlike `parseBody`, this NEVER throws — and the body is released
 * unconditionally (success or fallback), because the tolerant path always
 * returns a value to the caller either way; there is no "leave body intact
 * for my own catch block" case here (there is no catch block — the try/catch
 * is internal to `parseJsonSafe`).
 *
 * Takes a structural `{ body: string }` — compatible with `ApiResponse`
 * (`src/tm1Rest/transport/types.ts`) without requiring an import.
 */
export function parseBodySafe<T>(res: { body: string }, fallback: T): T {
  const parsed = parseJsonSafe<T>(res.body, fallback);
  (res as { body?: string }).body = '';
  return parsed;
}

/**
 * TOLERANT envelope parse + release. Mirrors call sites that use
 * `parseEnvelope(res.body).value ?? []` — same fallback-to-`[]` semantics as
 * `parseEnvelope`/`parseODataValue` (bad JSON or missing `value` → `[]`), plus
 * releasing `res.body` afterwards so V8 can collect the raw wire string.
 *
 * Same never-throws / always-releases contract as `parseBodySafe`.
 *
 * Takes a structural `{ body: string }` — compatible with `ApiResponse`
 * (`src/tm1Rest/transport/types.ts`) without requiring an import.
 */
export function parseEnvelopeBody<T>(res: { body: string }): T[] {
  const parsed = parseEnvelope<T>(res.body).value ?? [];
  (res as { body?: string }).body = '';
  return parsed;
}

/**
 * TOLERANT OData `value`-array parse + release: `parseODataValue<T>(res.body)`
 * plus release. Kept as a separate entry point (rather than folding into
 * `parseEnvelopeBody`) to mirror the existing `parseEnvelope`/`parseODataValue`
 * pair at call sites that already call `parseODataValue` directly.
 */
export function parseODataValueBody<T>(res: { body: string }): T[] {
  const parsed = parseODataValue<T>(res.body);
  (res as { body?: string }).body = '';
  return parsed;
}

/**
 * OData `value`-array parse that preserves Int64 `ID` values which exceed JS's
 * safe-integer range (e.g. v12 session ids, ~19 digits) by quoting them into
 * strings BEFORE JSON.parse — plain JSON.parse silently rounds a 16+ digit
 * integer, so the displayed id would be wrong. Only unquoted `"ID":<16+ digits>`
 * are affected (GUID ids are already quoted). Parses AND releases the body like
 * the other helpers. Returns `[]` on a non-object / missing `value`.
 */
export function parseODataValueBodyBigIntIds<T>(res: { body: string }): T[] {
  const quoted = (res.body ?? '').replace(/"ID":\s*(\d{16,})/g, '"ID":"$1"');
  (res as { body?: string }).body = '';
  try {
    const parsed = JSON.parse(quoted) as { value?: T[] };
    return Array.isArray(parsed?.value) ? parsed.value : [];
  } catch {
    return [];
  }
}
