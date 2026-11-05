// src/serverConfig/configDiff.ts
import * as vscode from 'vscode';
import type { ParamType } from './paramSchema';

export interface DiffEntry {
  name: string;
  oldValue: unknown;
  newValue: unknown;
}

export function coerceType(raw: unknown, def: { type: ParamType; enumValues?: string[] } | undefined): unknown {
  if (def === undefined) { return raw; }
  switch (def.type) {
    case 'number': {
      const trimmed = typeof raw === 'string' ? raw.trim() : raw;
      if (trimmed === '' || trimmed === null) {
        throw new Error(vscode.l10n.t('Value "{0}" is not a number', String(raw)));
      }
      const n = Number(trimmed);
      if (!Number.isFinite(n)) { throw new Error(vscode.l10n.t('Value "{0}" is not a finite number', String(raw))); }
      return n;
    }
    case 'bool': {
      const s = String(raw).toLowerCase();
      if (s === 'true' || s === '1') { return true; }
      if (s === 'false' || s === '0') { return false; }
      throw new Error(vscode.l10n.t('Value "{0}" is not a boolean (allowed: true/false/1/0)', String(raw)));
    }
    case 'enum': {
      if (!def.enumValues || def.enumValues.length === 0) {
        throw new Error(vscode.l10n.t('Enum definition for this parameter is missing'));
      }
      const s = String(raw);
      if (!def.enumValues.includes(s)) {
        throw new Error(vscode.l10n.t('Value "{0}" not in enum [{1}]', s, def.enumValues.join(',')));
      }
      // A numeric enum goes onto the wire as a NUMBER. Measured on 2026-09-18
      // on 11.8: `{"IntegratedSecurityMode": "2"}` is rejected with
      // `400 code 278 Invalid enum value encountered in payload.`,
      // `{"IntegratedSecurityMode": 2}` is accepted with `200`.
      return def.enumValues.every(v => /^\d+$/.test(v)) ? Number(s) : s;
    }
    case 'string':
    default:
      return String(raw);
  }
}

/**
 * Equality used by buildDiff: handles primitives via Object.is and
 * arrays/plain-objects via stringified deep-compare. Necessary because
 * postMessage between webview and host structurally-clones values, so
 * arrays/objects that started as the same reference end up as different
 * references on the host side and would otherwise always read as "changed".
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) { return true; }
  if (a === null || b === null) { return false; }
  if (typeof a !== typeof b) { return false; }
  if (typeof a !== 'object') { return false; }
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

export function buildDiff(
  orig: Map<string, unknown>,
  edited: Map<string, unknown>,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const [name, newVal] of edited) {
    const oldVal = orig.get(name);
    if (!valuesEqual(oldVal, newVal)) {
      out.push({ name, oldValue: oldVal, newValue: newVal });
    }
  }
  return out;
}
