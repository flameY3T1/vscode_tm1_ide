/**
 * Pure helpers for the process-editor linter UI.
 *
 * Extracted from `linter.ts` (Hebel 17 — Iter 4). No DOM, no Monaco import,
 * no module state. Inputs are explicit.
 */

import type { LintDiagnose, LintSeverity } from '../../tiLogicVisualizer/lintTypes';

export {};

export type { SectionKey } from './sectionTypes';
import type { SectionKey } from './sectionTypes';

export const SECTION_ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];
export const SECTION_LABELS: Record<SectionKey, string> = {
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
};

export type SeverityFilter = LintSeverity | 'all';

export interface FlatItem {
  section: SectionKey;
  sectionLabel: string;
  line: number;
  severity: LintSeverity;
  message: string;
  ruleId: string;
}

/**
 * Strip a leading `[rule-id]` prefix (with trailing whitespace) from a lint
 * message. Idempotent; leaves messages without a prefix unchanged.
 */
export function stripRuleIdPrefix(msg: string): string {
  return msg.replace(/^\[[^\]]+\]\s*/, '');
}

export { escapeHtml } from '../htmlUtils';

/**
 * Map a LintSeverity to the corresponding Monaco MarkerSeverity numeric value.
 * Returns Monaco's numeric enum values directly (Error=8, Warning=4, Hint=1)
 * so the caller doesn't depend on the monaco enum at runtime.
 */
export function severityToMarker(sev: LintSeverity): 1 | 2 | 4 | 8 {
  if (sev === 'error') { return 8; }
  if (sev === 'warning') { return 4; }
  if (sev === 'info') { return 2; } // MarkerSeverity.Info
  return 1;
}

/**
 * Merge three diagnostic streams for one section in display order
 * (main parse/AST → server lint → compile errors).
 */
export function mergedSection(
  section: SectionKey,
  main: Record<SectionKey, LintDiagnose[]>,
  server: Record<SectionKey, LintDiagnose[]>,
  compile: Record<SectionKey, LintDiagnose[]>,
): LintDiagnose[] {
  return [...main[section], ...server[section], ...compile[section]];
}

/**
 * Flatten per-section diagnostics into a sorted FlatItem list.
 * Sort key: (SECTION_ORDER index, line ASC).
 */
export function flattenDiagnostics(
  perSection: Record<SectionKey, LintDiagnose[]>,
): FlatItem[] {
  const items: FlatItem[] = [];
  for (const section of SECTION_ORDER) {
    for (const d of perSection[section]) {
      items.push({
        section,
        sectionLabel: SECTION_LABELS[section],
        line: d.line,
        severity: d.severity,
        message: stripRuleIdPrefix(d.message ?? ''),
        ruleId: d.ruleId,
      });
    }
  }
  items.sort((a, b) => {
    const so = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    if (so !== 0) { return so; }
    return a.line - b.line;
  });
  return items;
}

/** Filter a flat-item list by severity. `'all'` passes everything. */
export function applySeverityFilter(items: FlatItem[], filter: SeverityFilter): FlatItem[] {
  if (filter === 'all') { return items; }
  return items.filter((i) => i.severity === filter);
}
