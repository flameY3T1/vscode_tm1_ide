/**
 * Synchronous Rules linter (parser-driven, no server access).
 *
 * Extracted from `rulesLinter.ts` in Post-H17 #6 split.
 */

import { parseRules } from '../rulesParser';
import type { RulesLintDiagnose } from './types';
import {
  neutralizeLine,
  bracketDepthChange,
  endsSemicolon,
  parenDepthChange,
  endsWithRuleTypeMarker,
  endsWithBackslashContinuation,
  endsWithContinuingOperator,
  startsWithContinuingOperator,
  startsWithStatementEnd,
  isValidRulesLineHead,
  isValidFeedersLineHead,
} from './helpers';
import { extractBracketRefs, validateBracketRefSyntax } from './brackets';
import { extractDbCalls } from './dbCalls';

export {};

/**
 * Cross-line carry state for the rules/feeders continuation tracker.
 *
 * Every field records how the PREVIOUS line left the current statement open —
 * collected in one object instead of loose `let`s so the set of things that
 * survive across the loop is explicit and self-documenting.
 */
interface LineCarry {
  /** Unclosed `(` depth carried from previous lines. */
  parenDepth: number;
  /** Unclosed `[` depth carried from previous lines. */
  bracketDepth: number;
  /** Previous line ended with a `C:`/`N:`/`S:`/`=` rule-type marker. */
  pendingRuleExpr: boolean;
  /** Feeder LHS opened with `=>`; following lines continue its target list. */
  pendingFeedersArrow: boolean;
  /** Previous line ended with a `\` line-continuation. */
  pendingBackslashCont: boolean;
  /** Previous line ended with a continuing operator (e.g. `+`, `||`). */
  pendingContinuingOp: boolean;
  /** Next line starts with a continuing operator (lookahead set). */
  pendingNextStartsWithOp: boolean;
  /** Previous feeder target closed; a following target needs a leading comma. */
  pendingFeederNeedsComma: boolean;
}

function freshCarry(): LineCarry {
  return {
    parenDepth: 0,
    bracketDepth: 0,
    pendingRuleExpr: false,
    pendingFeedersArrow: false,
    pendingBackslashCont: false,
    pendingContinuingOp: false,
    pendingNextStartsWithOp: false,
    pendingFeederNeedsComma: false,
  };
}

/** True when the carried state says the current line continues an open statement. */
function isContinuationLine(c: LineCarry): boolean {
  return c.parenDepth > 0
    || c.bracketDepth > 0
    || c.pendingRuleExpr
    || c.pendingFeedersArrow
    || c.pendingBackslashCont
    || c.pendingContinuingOp
    || c.pendingNextStartsWithOp;
}

export function lintRules(text: string): RulesLintDiagnose[] {
  const ast = parseRules(text);
  const diags: RulesLintDiagnose[] = [];

  if (ast.feedersCount === 0) {
    const hasContent = ast.lines.some(l => !l.isBlank && !l.isComment && !l.isSkipcheck && !l.isFeedstrings && !l.isUndefvals);
    if (hasContent) {
      diags.push({
        line: 0,
        messageKey: 'No FEEDERS; block found. Without feeders no rules are calculated.',
        severity: 'warning',
        ruleId: 'no-feeders-section',
      });
    }
  }

  if (ast.feedersCount > 1) {
    let seen = 0;
    for (const l of ast.lines) {
      if (l.isFeedersMarker) {
        seen++;
        if (seen > 1) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'Multiple FEEDERS; markers found. Only the first one is recognized by TM1.',
            severity: 'error',
            ruleId: 'multiple-feeders',
          });
        }
      }
    }
  }

  const continuedByNextLine = new Set<number>();
  {
    let prev = -1;
    for (const l of ast.lines) {
      if (l.isBlank || l.isComment || l.isSkipcheck || l.isFeedstrings || l.isUndefvals || l.isFeedersMarker) { continue; }
      if (prev !== -1 && (startsWithContinuingOperator(l.trimmed) || startsWithStatementEnd(l.trimmed))) {
        continuedByNextLine.add(prev);
      }
      prev = l.lineIndex;
    }
  }

  const carry = freshCarry();

  for (const l of ast.lines) {
    if (l.isBlank || l.isComment || l.isSkipcheck || l.isFeedstrings || l.isUndefvals || l.isFeedersMarker) {
      continue;
    }

    const isContinuation = isContinuationLine(carry);
    carry.parenDepth = Math.max(0, carry.parenDepth + parenDepthChange(l.trimmed));
    const hasOpenParens = carry.parenDepth > 0;
    carry.bracketDepth = Math.max(0, carry.bracketDepth + bracketDepthChange(l.trimmed));
    const hasOpenBracket = carry.bracketDepth > 0;
    carry.pendingRuleExpr = endsWithRuleTypeMarker(l.trimmed);
    const thisLineEndsRuleType = carry.pendingRuleExpr;
    carry.pendingBackslashCont = endsWithBackslashContinuation(l.trimmed);
    const thisLineEndsBackslash = carry.pendingBackslashCont;
    carry.pendingContinuingOp = endsWithContinuingOperator(l.trimmed);
    const thisLineEndsContOp = carry.pendingContinuingOp;
    const thisLineContinuedByNext = continuedByNextLine.has(l.lineIndex);
    carry.pendingNextStartsWithOp = thisLineContinuedByNext;

    const hasSemi = endsSemicolon(l.trimmed);

    // Cell references may span several lines (e.g. `['Dim':'El',\n 'Dim2':'El2']`).
    // Only when the statement actually ends (`;`) and brackets are still open
    // is there a real error — otherwise a line break in the ref is a false positive.
    if (hasSemi && hasOpenBracket) {
      diags.push({
        line: l.lineIndex,
        messageKey: 'Unclosed square bracket `[`.',
        severity: 'error',
        ruleId: 'unclosed-bracket',
      });
    }
    if (hasSemi) { carry.bracketDepth = 0; }

    if (l.section === 'rules') {
      if (!hasSemi && !isContinuation && !hasOpenParens && !hasOpenBracket && !thisLineEndsRuleType && !thisLineEndsBackslash && !thisLineEndsContOp && !thisLineContinuedByNext) {
        diags.push({
          line: l.lineIndex,
          messageKey: 'Statement does not end with a semicolon.',
          severity: 'error',
          ruleId: 'missing-semicolon',
        });
      }

      if (hasSemi && !isContinuation) {
        if (!isValidRulesLineHead(l.trimmed)) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'Invalid Rules statement — expected `[cell reference] = expression;` or a `C:`/`N:`/`S:` marker.',
            severity: 'error',
            ruleId: 'parse-error',
          });
        }
      }
    }

    if (l.section === 'feeders') {
      const neutralFeed = neutralizeLine(l.trimmed);
      const hasArrow = neutralFeed.includes('=>');
      const headValid = isValidFeedersLineHead(l.trimmed);

      if (!isContinuation && !headValid) {
        diags.push({
          line: l.lineIndex,
          messageKey: 'Invalid Feeder statement — expected `[cell reference] => target(s);`.',
          severity: 'error',
          ruleId: 'parse-error',
        });
      }

      if (isContinuation && carry.pendingFeederNeedsComma) {
        const startsNewTarget = /^\s*(\[|[A-Za-z_]\w*\s*\()/.test(l.trimmed);
        if (startsNewTarget) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'Missing comma between feeder targets.',
            severity: 'error',
            ruleId: 'feeder-missing-comma',
          });
        }
      }

      const arrowIdx = neutralFeed.indexOf('=>');
      if (arrowIdx > 0) {
        const lhs = neutralFeed.slice(0, arrowIdx);
        const lhsCloseCount = (lhs.match(/\]/g) || []).length;
        if (lhsCloseCount > 1) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'The left side of a feeder must be a single cell reference, not several.',
            severity: 'error',
            ruleId: 'feeder-multi-lhs',
          });
        }
      }

      const sameLineRe = /[\])]\s+(?:\[|[A-Za-z_]\w*\s*\()/g;
      let m: RegExpExecArray | null;
      while ((m = sameLineRe.exec(neutralFeed)) !== null) {
        if (arrowIdx >= 0 && m.index < arrowIdx) { continue; }
        diags.push({
          line: l.lineIndex,
          messageKey: 'Missing comma between feeder targets.',
          severity: 'error',
          ruleId: 'feeder-missing-comma',
        });
        break;
      }

      if (!isContinuation) {
        carry.pendingFeedersArrow = headValid && !hasSemi;
      } else if (hasSemi) {
        carry.pendingFeedersArrow = false;
      }

      const stripped = neutralFeed.replace(/\s+$/, '');
      const lastChar = stripped.slice(-1);
      const endsWithTargetClose = lastChar === ']' || lastChar === ')';
      carry.pendingFeederNeedsComma =
        carry.pendingFeedersArrow &&
        endsWithTargetClose &&
        !hasSemi &&
        !hasOpenParens &&
        !thisLineEndsContOp &&
        !thisLineEndsBackslash &&
        !stripped.endsWith('=>');

      if (!hasSemi && !isContinuation && !hasOpenParens && !hasOpenBracket && !thisLineEndsRuleType && !thisLineEndsBackslash && !thisLineEndsContOp && !thisLineContinuedByNext && !carry.pendingFeedersArrow) {
        diags.push({
          line: l.lineIndex,
          messageKey: 'Statement does not end with a semicolon.',
          severity: 'error',
          ruleId: 'missing-semicolon',
        });
      }

      if (!isContinuation) {
        const strippedFeed = l.trimmed.replace(/#.*$/, '').replace(/'[^']*'/g, '""');
        if (!hasArrow && !carry.pendingFeedersArrow) {
          if (strippedFeed.includes('[')) {
            diags.push({
              line: l.lineIndex,
              messageKey: 'Feeder line without `=>` operator.',
              severity: 'warning',
              ruleId: 'feeder-missing-arrow',
            });
          }
        }

        const dbIdx = neutralFeed.search(/\bDB\s*\(/i);
        if (dbIdx !== -1 && (arrowIdx === -1 || dbIdx < arrowIdx)) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'DB() is invalid on the left side of a feeder. The source cell reference must be [...], DB() only on the right side.',
            severity: 'error',
            ruleId: 'feeder-db-on-lhs',
          });
        }

        if (/=\s*[CNS]\s*:/i.test(strippedFeed)) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'Rule line (C:/N:/S:) after FEEDERS; — rules belong before the FEEDERS block.',
            severity: 'warning',
            ruleId: 'rule-after-feeders',
          });
        }
      }
    }

    for (const refContent of extractBracketRefs(l.trimmed)) {
      const refErr = validateBracketRefSyntax(refContent);
      if (refErr !== null) {
        // Two rule ids, because they are two different things: a genuinely broken
        // reference, and the style hint on an unqualified element name (['Umsatz'] —
        // valid TM1, just ambiguous). Separate ids let the second one be silenced
        // without losing the first.
        diags.push({
          line: l.lineIndex,
          messageKey: refErr.messageKey,
          messageArgs: refErr.messageArgs,
          severity: 'hint',
          ruleId: refErr.kind === 'unqualified' ? 'unqualified-cell-ref' : 'invalid-cell-ref-syntax',
        });
      }
    }

    for (const call of extractDbCalls(l.trimmed)) {
      if (call.args.length < 2) {
        diags.push({
          line: l.lineIndex,
          messageKey: 'DB() needs at least 2 arguments (cube name + 1 dimension).',
          severity: 'error',
          ruleId: 'db-too-few-args',
        });
      } else if (call.cubeName === null) {
        const first = call.args[0]?.trim() ?? '';
        // A function call as the first arg (e.g. `IF(...)`, `Subst(...)`) is a
        // conditional/dynamic cube name — often a deliberate trick to keep a
        // feeder inactive. Don't flag it as a hard error; emit a hint instead.
        if (/^[A-Za-z_]\w*\s*\(/.test(first)) {
          diags.push({
            line: l.lineIndex,
            messageKey: 'First DB() argument is a function call instead of a string literal — possibly intentional (e.g. to conditionally disable a feeder).',
            severity: 'hint',
            ruleId: 'db-conditional-cube-arg',
          });
        } else {
          diags.push({
            line: l.lineIndex,
            messageKey: 'First DB() argument must be a string literal (cube name in single quotes).',
            severity: 'error',
            ruleId: 'db-invalid-cube-arg',
          });
        }
      }
    }
  }

  return diags;
}
