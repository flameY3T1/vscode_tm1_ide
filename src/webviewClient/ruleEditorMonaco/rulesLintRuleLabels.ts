import type { RulesLintRuleId, RulesLintSeverity } from '../../tiLogicVisualizer/rulesLinter/ruleConfig';
import { getL10n } from '../_shared/l10n';

const L = getL10n();

/** Human-readable name + one-line description per ruleId of the RULES linter. */
export const RULES_RULE_LABELS: Record<RulesLintRuleId, { name: string; desc: string }> = {
  'parse-error':             { name: L.rlParseErrorName,      desc: L.rlParseErrorDesc },
  'missing-semicolon':       { name: L.rlMissingSemiName,     desc: L.rlMissingSemiDesc },
  'unclosed-bracket':        { name: L.rlUnclosedBracketName, desc: L.rlUnclosedBracketDesc },
  'invalid-cell-ref-syntax': { name: L.rlInvalidRefName,      desc: L.rlInvalidRefDesc },
  'unqualified-cell-ref':    { name: L.rlUnqualifiedRefName,  desc: L.rlUnqualifiedRefDesc },
  'no-feeders-section':      { name: L.rlNoFeedersName,       desc: L.rlNoFeedersDesc },
  'multiple-feeders':        { name: L.rlMultiFeedersName,    desc: L.rlMultiFeedersDesc },
  'rule-after-feeders':      { name: L.rlRuleAfterFeedName,   desc: L.rlRuleAfterFeedDesc },
  'feeder-missing-arrow':    { name: L.rlFeedArrowName,       desc: L.rlFeedArrowDesc },
  'feeder-missing-comma':    { name: L.rlFeedCommaName,       desc: L.rlFeedCommaDesc },
  'feeder-multi-lhs':        { name: L.rlFeedMultiLhsName,    desc: L.rlFeedMultiLhsDesc },
  'feeder-db-on-lhs':        { name: L.rlFeedDbLhsName,       desc: L.rlFeedDbLhsDesc },
  'db-too-few-args':         { name: L.rlDbFewArgsName,       desc: L.rlDbFewArgsDesc },
  'db-arg-count-mismatch':   { name: L.rlDbArgCountName,      desc: L.rlDbArgCountDesc },
  'db-invalid-cube-arg':     { name: L.rlDbInvalidCubeName,   desc: L.rlDbInvalidCubeDesc },
  'db-conditional-cube-arg': { name: L.rlDbCondCubeName,      desc: L.rlDbCondCubeDesc },
  'db-unknown-cube':         { name: L.rlDbUnknownCubeName,   desc: L.rlDbUnknownCubeDesc },
  'db-element-not-found':    { name: L.rlDbElemName,          desc: L.rlDbElemDesc },
  'dimension-not-found':     { name: L.rlDimNotFoundName,     desc: L.rlDimNotFoundDesc },
  'hierarchy-not-found':     { name: L.rlHierNotFoundName,    desc: L.rlHierNotFoundDesc },
  'element-not-found':       { name: L.rlElemNotFoundName,    desc: L.rlElemNotFoundDesc },
};

export const RULES_SEVERITY_LABELS: Record<RulesLintSeverity, string> = {
  error: L.rlSevError,
  warning: L.rlSevWarning,
  info: L.rlSevInfo,
  hint: L.rlSevHint,
};

/** Group headings, keyed by the `key` in RULES_LINT_GROUPS. */
export const RULES_GROUP_LABELS: Record<string, string> = {
  syntax: L.rlGroupSyntax,
  feeders: L.rlGroupFeeders,
  db: L.rlGroupDb,
  server: L.rlGroupServer,
  other: L.rlGroupOther,
};
