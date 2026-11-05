import { MEMBER_PROPERTIES } from './mdxFunctions';
import { tokenizeMdx, type Token } from './formatMdxPure';

export interface ElementRef {
  dim: string;
  /** Hierarchy from the three-segment form; absent = the dimension's default. */
  hier?: string;
  element: string;
  /** Offset of the opening `[` of the whole `[Dim].[Elem]` slice. */
  offset: number;
  /** Length from `[Dim` through the closing `]` of `[Elem]`. */
  length: number;
}

const MEMBER_PROP_LC = new Set(MEMBER_PROPERTIES.map(p => p.toLowerCase()));

/**
 * Captures `WITH MEMBER [X].[Name]` — the inner name is a calculated-member
 * identifier and must NOT be validated against server elements.
 */
export function extractCalculatedMemberNames(text: string): Set<string> {
  const names = new Set<string>();
  const selMatch = /\bSELECT\b/i.exec(text);
  const scope = selMatch ? text.slice(0, selMatch.index) : text;
  const re = /\bMEMBER\s+\[[^\]]+\]\s*\.\s*\[([^\]]+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) { names.add(m[1]); }
  return names;
}

/** `[a]]b]` addresses the element `a]b` — `]]` is MDX's escape for one `]`. */
function bracketInner(text: string): string {
  const inner = text.endsWith(']') ? text.slice(1, -1) : text.slice(1);
  return inner.replace(/\]\]/g, ']');
}

function isDot(t: Token | undefined): boolean {
  return t !== undefined && t.kind === 'op' && t.text === '.';
}

/**
 * Element references out of an MDX statement, for the runner's name check.
 *
 * Runs on `tokenizeMdx()` rather than on a regex of its own: the tokenizer
 * already knows the two things a regex over brackets cannot see — that `]]`
 * escapes a literal `]` inside a name, and that a comment or a quoted string is
 * not statement text. A second, thinner lexer for the same
 * language was where every false squiggle came from (review 2026-09-19, D1/D2).
 */
export function extractElementRefs(text: string): ElementRef[] {
  const calcNames = extractCalculatedMemberNames(text);
  const toks = tokenizeMdx(text).filter(t => t.kind !== 'comment' && t.kind !== 'lineComment');
  const out: ElementRef[] = [];

  for (let i = 0; i < toks.length; i++) {
    if (toks[i].kind !== 'bracket' || !isDot(toks[i + 1]) || toks[i + 2]?.kind !== 'bracket') {
      continue;
    }
    // `[Dim].[Hier].[Elem]` when a third bracket follows, else `[Dim].[Elem]`.
    const threePart = isDot(toks[i + 3]) && toks[i + 4]?.kind === 'bracket';
    const last = threePart ? i + 4 : i + 2;
    const dim = bracketInner(toks[i].text);
    const elem = bracketInner(toks[last].text);
    const next = toks[last + 1];
    const first = toks[i];
    const lastTok = toks[last];
    i = last;

    // `[Dim].[Hier].MEMBERS` — the unbracketed tail makes the SECOND bracket a
    // hierarchy, not an element. `[Dim].[Elem].PARENT` loses its element check
    // that way — a missed check beats a squiggle under correct MDX.
    if (!threePart && isDot(next) && toks[last + 2]?.kind === 'word') { continue; }

    // Exclude member properties (.Members, .Children, …).
    if (MEMBER_PROP_LC.has(elem.toLowerCase())) { continue; }

    // Exclude calculated-member references.
    if (calcNames.has(elem)) { continue; }

    // Exclude function calls: [Dim].[Fn]( …
    if (next?.kind === 'open' && next.text === '(') { continue; }

    // `hier` means "a NAMED alternate hierarchy". `[Jahre].[Jahre].[2025]` is
    // the default one written out — the form the cube viewer and the runner
    // generate. Reporting it as a hierarchy switched the caller's
    // "dimension unknown" check off for every generated statement (D3).
    const hier = threePart ? bracketInner(toks[i - 2].text) : undefined;

    out.push({
      dim,
      ...(hier !== undefined && hier.toLowerCase() !== dim.toLowerCase() ? { hier } : {}),
      element: elem,
      offset: first.start,
      length: lastTok.start + lastTok.text.length - first.start,
    });
  }
  return out;
}
