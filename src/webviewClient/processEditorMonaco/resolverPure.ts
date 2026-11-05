/** Pure helpers for resolver.ts — no monaco/dom dependencies. */

export type { SectionKey } from './sectionTypes';
import type { SectionKey } from './sectionTypes';

export interface ResolverArgPart {
  identifier: string;
  kind: 'literal' | 'param' | 'datasource';
  display: string;
}

export interface ResolverArg {
  name: string;
  raw: string;
  kind: 'literal' | 'param' | 'datasource' | 'dynamic';
  display: string;
  parts?: ResolverArgPart[];
}

export interface ResolverRow {
  section: SectionKey;
  line: number;
  funcName: string;
  args: ResolverArg[];
}

export const SECTION_LABELS: Readonly<Record<SectionKey, string>> = Object.freeze({
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
});

import { escapeHtml as _escapeHtml } from '../htmlUtils';
export const escapeHtml = _escapeHtml;

/**
 * Wrap a live debug value into the `resolver-arg-live` span.
 * The value is HTML-escaped.
 */
export function liveSpan(value: string): string {
  return ' <span class="resolver-arg-live">= ' + escapeHtml(value) + '</span>';
}

/**
 * Returns true when `needle` (already lowercased) matches any searchable
 * field on the resolver row: funcName, section label/key, line number,
 * arg name/raw/display, or any structured arg part identifier/display.
 *
 * Empty needle matches everything (filter-disabled case).
 */
export function rowMatches(r: ResolverRow, needle: string): boolean {
  if (!needle) { return true; }
  if (r.funcName.toLowerCase().includes(needle)) { return true; }
  if (SECTION_LABELS[r.section].toLowerCase().includes(needle)) { return true; }
  if (r.section.toLowerCase().includes(needle)) { return true; }
  if (String(r.line).includes(needle)) { return true; }
  for (const a of r.args) {
    if (a.name.toLowerCase().includes(needle)) { return true; }
    if (a.raw.toLowerCase().includes(needle)) { return true; }
    if (a.display.toLowerCase().includes(needle)) { return true; }
    if (a.parts) {
      for (const p of a.parts) {
        if (p.identifier.toLowerCase().includes(needle)) { return true; }
        if (p.display.toLowerCase().includes(needle)) { return true; }
      }
    }
  }
  return false;
}
