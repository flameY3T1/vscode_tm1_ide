/**
 * Pure (vscode-free) serializer/parser for the TI-config import/export bundle.
 *
 * A bundle carries the three per-server TI configs — linter rules, TI formatter,
 * rules formatter — in one portable JSON file. `buildBundle` produces the object
 * to write; `parseBundle` validates + normalizes a loaded file. No file I/O and
 * no `Date` here (the timestamp is injected) so this is fully unit-testable.
 */
import type { LintRuleConfig } from '../../tiLogicVisualizer/tiLinter/ruleConfig';
import { mergeFormatConfig, type TiFormatConfig } from '../../tiLogicVisualizer/formatRules';
import { mergeRuleFormatConfig, type RuleFormatConfig } from '../../tiLogicVisualizer/formatRulesText';

export const BUNDLE_TYPE = 'tm1-ti-config';
export const BUNDLE_VERSION = 1;

export interface ConfigBundle {
  $type: typeof BUNDLE_TYPE;
  version: number;
  exportedAt: string;
  lintConfig: LintRuleConfig;
  formatConfig: TiFormatConfig;
  ruleFormatConfig: RuleFormatConfig;
}

export type ParseResult =
  | { ok: true; lint?: LintRuleConfig; format?: TiFormatConfig; ruleFormat?: RuleFormatConfig }
  | { ok: false; error: string };

/** Build the bundle object for export. `nowIso` is injected (caller passes
 *  `new Date().toISOString()`) so this stays deterministic for tests. */
export function buildBundle(
  lint: LintRuleConfig,
  format: TiFormatConfig,
  ruleFormat: RuleFormatConfig,
  nowIso: string,
): ConfigBundle {
  return {
    $type: BUNDLE_TYPE,
    version: BUNDLE_VERSION,
    exportedAt: nowIso,
    lintConfig: lint,
    formatConfig: format,
    ruleFormatConfig: ruleFormat,
  };
}

/** Faithfully normalize a stored lint config, preserving all three fields.
 *  (lintConfigStore.normalizeLintConfig is not vscode-free, so it can't be
 *  imported here — same preservation logic, inlined.) */
function normLint(x: unknown): LintRuleConfig | undefined {
  if (!x || typeof x !== 'object') { return undefined; }
  const o = x as Partial<LintRuleConfig>;
  if (!o.rules || typeof o.rules !== 'object') { return undefined; }
  const out: LintRuleConfig = { rules: { ...o.rules } };
  if (o.unusedVariableSections && typeof o.unusedVariableSections === 'object') {
    out.unusedVariableSections = { ...o.unusedVariableSections };
  }
  if (o.namingPrefixes && typeof o.namingPrefixes === 'object') {
    out.namingPrefixes = { ...o.namingPrefixes };
  }
  return out;
}

/**
 * Parse + validate a bundle JSON string. Tolerant: a missing config block is
 * simply omitted from the result (the caller leaves the existing stored value
 * untouched); format/rule-format blocks are backfilled with defaults via their
 * merge functions. Returns `{ ok: false }` only for unreadable JSON or a wrong
 * `$type` marker.
 */
export function parseBundle(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'wrongType' };
  }
  const b = raw as Partial<ConfigBundle>;
  if (b.$type !== BUNDLE_TYPE) {
    return { ok: false, error: 'wrongType' };
  }
  const result: Extract<ParseResult, { ok: true }> = { ok: true };
  const lint = normLint(b.lintConfig);
  if (lint) { result.lint = lint; }
  if (b.formatConfig && typeof b.formatConfig === 'object') {
    result.format = mergeFormatConfig(b.formatConfig);
  }
  if (b.ruleFormatConfig && typeof b.ruleFormatConfig === 'object') {
    result.ruleFormat = mergeRuleFormatConfig(b.ruleFormatConfig);
  }
  return result;
}
