/**
 * TI auto-formatter pipeline. Ordered, config-gated, idempotent.
 * Content rules operate on string/comment-masked text; the existing
 * IF/WHILE indentation logic runs last.
 */
import {
  type TiFormatConfig, DEFAULT_FORMAT_CONFIG, commentStart,
  collapseSpaces, spaceAfterComma, noSpaceBeforeSemicolon, stripTrailing,
  parenSpacing, operatorSpacing, keywordCasing, normalizeIdentifierCase, splitStatements,
  spaceAfterCommentHash, collapseBlankLines, wrapLongCalls,
} from './formatRules';

function stripStringsAndComments(line: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === "'") { inStr = false; } out += ' '; continue; }
    if (c === "'") { inStr = true; out += ' '; continue; }
    if (c === '#') { break; }
    out += c;
  }
  return out;
}

interface KwToken { kw: 'IF' | 'WHILE' | 'ENDIF' | 'END' | 'ELSE' | 'ELSEIF'; index: number; }

function isStatementStart(clean: string, idx: number): boolean {
  for (let j = idx - 1; j >= 0; j--) {
    const c = clean[j];
    if (/\s/.test(c)) { continue; }
    if (c === ';') { return true; }
    return false;
  }
  return true;
}

/**
 * TI overloads `IF`: the block opener `IF(cond);…ENDIF;` takes ONE argument,
 * while the inline function `IF(cond, then, else)` takes three. Both use
 * parentheses, so a statement-start `IF(` alone is ambiguous. The inline form
 * is distinguished by a top-level comma in its argument list — that one must
 * NOT be counted as a block opener (it has no matching ENDIF).
 */
function isInlineIfCall(clean: string, afterKwIdx: number): boolean {
  let k = afterKwIdx;
  while (k < clean.length && /\s/.test(clean[k])) { k++; }
  if (clean[k] !== '(') { return false; }
  let depth = 0;
  for (; k < clean.length; k++) {
    const c = clean[k];
    if (c === '(') { depth++; }
    else if (c === ')') { depth--; if (depth === 0) { break; } }
    else if (c === ',' && depth === 1) { return true; }
  }
  return false;
}

function collectKeywords(clean: string): KwToken[] {
  const re = /\b(IF|WHILE|ENDIF|END|ELSEIF|ELSE)\b/gi;
  const tokens: KwToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const kw = m[1].toUpperCase() as KwToken['kw'];
    if (kw === 'IF' || kw === 'WHILE') {
      if (!isStatementStart(clean, m.index)) { continue; }
      // Inline IF(cond, then, else) is an expression, not a block — skip it.
      if (kw === 'IF' && isInlineIfCall(clean, m.index + m[1].length)) { continue; }
    }
    tokens.push({ kw, index: m.index });
  }
  return tokens;
}

/** Existing IF/WHILE depth-based indentation. Only touches leading whitespace. */
function indentLines(lines: string[], indentUnit: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const rawLine of lines) {
    if (rawLine.trim() === '') { out.push(''); continue; }
    const clean = stripStringsAndComments(rawLine);
    const trimmed = rawLine.replace(/^[\t ]+/, '');
    const tokens = collectKeywords(clean);
    const first = tokens[0];
    const firstIsClose = !!first
      && (first.kw === 'ENDIF' || first.kw === 'END' || first.kw === 'ELSE' || first.kw === 'ELSEIF')
      && /^\s*$/.test(clean.slice(0, first.index));
    let net = 0;
    for (const t of tokens) {
      if (t.kw === 'IF' || t.kw === 'WHILE') { net++; }
      else if (t.kw === 'ENDIF' || t.kw === 'END') { net--; }
    }
    const printDepth = firstIsClose ? Math.max(0, depth - 1) : depth;
    out.push(indentUnit.repeat(printDepth) + trimmed);
    depth = Math.max(0, depth + net);
  }
  return out;
}

/** Apply all enabled content rules to one already-split line. */
function applyContentRules(line: string, cfg: TiFormatConfig): string {
  const ci = commentStart(line);
  let code = ci >= 0 ? line.slice(0, ci) : line;
  const comment = ci >= 0 ? line.slice(ci) : '';

  if (cfg.enabled['collapse-spaces']) { code = collapseSpaces(code); }
  if (cfg.enabled['space-after-comma']) { code = spaceAfterComma(code); }
  if (cfg.enabled['no-space-before-semicolon']) { code = noSpaceBeforeSemicolon(code); }
  if (cfg.parenStyle !== 'off') { code = parenSpacing(code, cfg.parenStyle); }
  if (cfg.enabled['operator-spacing']) { code = operatorSpacing(code); }
  if (cfg.enabled['keyword-case']) { code = keywordCasing(code, cfg.keywordCase); }
  if (cfg.enabled['normalize-identifier-case'] && cfg.identifierCanonical) {
    code = normalizeIdentifierCase(code, cfg.identifierCanonical);
  }

  let out = code + comment;
  if (cfg.enabled['no-trailing-space']) { out = stripTrailing(out); }
  if (cfg.enabled['space-after-comment']) { out = spaceAfterCommentHash(out); }
  return out;
}

export function formatTi(text: string, cfg: TiFormatConfig = DEFAULT_FORMAT_CONFIG): string {
  let lines = text.split('\n');
  if (cfg.enabled['one-statement-per-line']) { lines = lines.flatMap(splitStatements); }
  lines = lines.map(l => applyContentRules(l, cfg));
  if (cfg.enabled['max-blank-lines']) { lines = collapseBlankLines(lines); }
  if (cfg.enabled['block-indent']) { lines = indentLines(lines, cfg.indentUnit); }
  // wrap-long-calls last: it owns the continuation indent of wrapped calls, which
  // block-indent (pure IF/WHILE depth) would otherwise flatten on re-format.
  if (cfg.enabled['wrap-long-calls']) { lines = wrapLongCalls(lines, cfg.indentUnit, cfg.wrapColumn ?? DEFAULT_FORMAT_CONFIG.wrapColumn); }
  return lines.join('\n');
}
