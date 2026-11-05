/**
 * TM1 Rules auto-formatter. Sibling of `formatTi` for cube-rules syntax.
 *
 * Reuses the pure, bracket-/string-/comment-aware helpers from `formatRules.ts`
 * (their shared `codeMask` already blanks `[...]` cell references, single-quoted
 * strings and `#` comments, so element refs are never mutated). Rules-specific
 * additions on top of the shared helpers:
 *   - `=>` feeder operator kept atomic (via MULTI_OPS) and spaced.
 *   - rule-type qualifier `n:/s:/c:` after `=` upper-cased (`= n:` → `= N:`).
 * Block indentation (formatTi's IF/WHILE depth pass) is intentionally NOT run:
 * rules have no IF/ENDIF blocks (IF is an inline function), so each statement's
 * author-chosen leading indentation is preserved.
 */
import {
  codeMask, commentStart, collapseSpaces, noSpaceBeforeSemicolon,
  parenSpacing, operatorSpacing, keywordCasing, splitStatements,
  spaceAfterCommentHash, collapseBlankLines, stripTrailing,
} from './formatRules';

/**
 * One space after every comma that is not inside a single-quoted string.
 *
 * Unlike the shared `spaceAfterComma` (which masks `[...]` interiors), this
 * also spaces structural commas inside `[...]`/`{...}` element-reference tuples
 * — e.g. `['Plan','Actual']` → `['Plan', 'Actual']`. Safe: element names are
 * single-quoted (protected here), `!dim` iterators are bare tokens, and TM1
 * ignores whitespace between tuple tokens. `code` is already comment-stripped.
 */
function rulesSpaceAfterComma(code: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    out += c;
    if (inStr) { if (c === "'") { inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < code.length && code[j] === ' ') { j++; }
      if (j < code.length) { out += ' '; }
      i = j - 1;
    }
  }
  return out;
}

/** Toggleable rule ids for the rules formatter (mirrors the dropdown order). */
export type RuleFormatRuleId =
  | 'casing' | 'operators' | 'commaSpace' | 'semicolon' | 'collapseSpaces'
  | 'trailing' | 'commentHash' | 'blankLines' | 'splitStatements';

export interface RuleFormatConfig {
  enabled: Record<RuleFormatRuleId, boolean>;
  parenStyle: 'tight' | 'spaced' | 'off';
}

export const DEFAULT_RULE_FORMAT_CONFIG: RuleFormatConfig = {
  enabled: {
    casing: true, operators: true, commaSpace: true, semicolon: true,
    collapseSpaces: true, trailing: true, commentHash: true,
    blankLines: true, splitStatements: true,
  },
  parenStyle: 'tight',
};

/** Overlay a (possibly partial) stored config onto defaults, backfilling flags. */
export function mergeRuleFormatConfig(stored: Partial<RuleFormatConfig> | undefined): RuleFormatConfig {
  if (!stored) { return { ...DEFAULT_RULE_FORMAT_CONFIG, enabled: { ...DEFAULT_RULE_FORMAT_CONFIG.enabled } }; }
  return {
    ...DEFAULT_RULE_FORMAT_CONFIG,
    ...stored,
    enabled: { ...DEFAULT_RULE_FORMAT_CONFIG.enabled, ...(stored.enabled ?? {}) },
  };
}

/**
 * Normalize a stand-alone `n:/s:/c:` rule-type qualifier after `=`:
 * upper-case the letter and force exactly one space after the colon
 * (`=n:1` → `= N: 1`). The space before `=` is owned by operatorSpacing.
 */
function ruleTypeCasing(code: string): string {
  const mask = codeMask(code);
  return code.replace(/=(\s*)([nscNSC])\s*:\s*/g, (full, _gap, letter, offset: number) => {
    // Guard: only when the `=` is real code (not inside a [...] ref or string).
    if (!mask[offset]) { return full; }
    return '= ' + letter.toUpperCase() + ': ';
  });
}

/** Canonicalize the `DB` rules function name (`db(` → `DB(`) at code level. */
function canonicalizeDb(code: string): string {
  const mask = codeMask(code);
  return code.replace(/\bdb\b/gi, (tok, offset: number) => (mask[offset] ? 'DB' : tok));
}

// Rules section/control keywords (mirror of rulesMonarch SECTION_KEYWORDS) —
// always upper-cased; not present in KNOWN_SIGNATURES.
const SECTION_KEYWORDS = new Set(['SKIPCHECK', 'FEEDERS', 'FEEDSTRINGS', 'STET', 'CONTINUE']);

/** Upper-case rules section keywords (`skipcheck;` → `SKIPCHECK;`) at code level. */
function sectionKeywordCasing(code: string): string {
  const mask = codeMask(code);
  return code.replace(/[A-Za-z]+/g, (tok, offset: number) =>
    (mask[offset] && SECTION_KEYWORDS.has(tok.toUpperCase()) ? tok.toUpperCase() : tok));
}

function applyContentRules(line: string, cfg: RuleFormatConfig): string {
  const ci = commentStart(line);
  let code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';

  if (cfg.enabled.collapseSpaces) { code = collapseSpaces(code); }
  if (cfg.enabled.commaSpace) { code = rulesSpaceAfterComma(code); }
  if (cfg.enabled.semicolon) { code = noSpaceBeforeSemicolon(code); }
  if (cfg.parenStyle !== 'off') { code = parenSpacing(code, cfg.parenStyle); }
  if (cfg.enabled.operators) { code = operatorSpacing(code); }
  if (cfg.enabled.casing) {
    code = keywordCasing(code, 'upper');
    code = ruleTypeCasing(code);
    // DB() is the core rules read function but is not in KNOWN_SIGNATURES
    // (it is injected as a literal builtin), so keywordCasing misses it.
    code = canonicalizeDb(code);
    code = sectionKeywordCasing(code);
  }

  let out = code + comment;
  if (cfg.enabled.trailing) { out = stripTrailing(out); }
  if (cfg.enabled.commentHash) { out = spaceAfterCommentHash(out); }
  return out;
}

export function formatRulesText(text: string, cfg: RuleFormatConfig = DEFAULT_RULE_FORMAT_CONFIG): string {
  let lines = text.split('\n');
  // Split only lines that genuinely hold >1 statement. splitStatements trims
  // each part, so single-statement lines are kept verbatim to preserve the
  // author's leading indentation (there is no block-indent pass for rules).
  if (cfg.enabled.splitStatements) {
    lines = lines.flatMap((line) => {
      const parts = splitStatements(line);
      if (parts.length <= 1) { return [line]; }
      const indent = (/^[ \t]*/.exec(line) as RegExpExecArray)[0];
      parts[0] = indent + parts[0];
      return parts;
    });
  }
  lines = lines.map(l => applyContentRules(l, cfg));
  if (cfg.enabled.blankLines) { lines = collapseBlankLines(lines); }
  return lines.join('\n');
}
