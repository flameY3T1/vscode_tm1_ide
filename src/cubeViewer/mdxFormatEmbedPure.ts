/**
 * Display formats → MDX view. TM1 has only one carrier for a format in MDX:
 * a calculated member with `FORMAT_STRING` (measured 11.8, 2026-09-27 —
 * `CELL CALCULATION` and `SCOPE` are syntax errors, redefining the element
 * itself is `Member already exists`). So each formatted element that stands
 * directly in an axis set is swapped for a reference member:
 *
 *   WITH MEMBER [D].[D].[Wert (Format)] AS [D].[D].[Wert], FORMAT_STRING = '…', CAPTION = 'Wert'
 *
 * It reads the same cells, but it is a calculated member: writing into the
 * cellset is refused (`CannotSpreadIntoViewMoreThanTwoAxes`, PAW's path),
 * a coordinate write to the original element works (measured 11.8,
 * 2026-09-27). So the viewer unwraps these members on open
 * (`unwrapDisplayFormats`), runs the plain MDX and shows the formats as
 * display formats — every cell stays writable here. Native views cannot
 * carry any of this.
 *
 * Members this module wrote before are recognised on the next save (same
 * name pattern, `AS` one member) and updated in place, not wrapped twice.
 */
import type { DisplayFormats } from './displayFormatPure';
import { hierKey, hierMdxRef, splitHierKey } from '../utils/hierKeyPure';
import { escapeMdx as esc } from '../utils/odataKey';
import { escapeRegex } from '../utils/escapeRegexPure';

export const FORMAT_SUFFIX = ' (Format)';

export interface EmbedResult {
  mdx: string;
  /** Formats that could not go into the MDX: element not a plain set item
   *  on an axis (slicer, inside a function, not in the query at all). */
  skipped: Array<{ dim: string; element: string }>;
}

const escQ = (s: string) => s.replace(/'/g, "''");
/**
 * Member of viewer key `key` (`dim` or `dim:hier`, see hierKeyPure):
 * `[Dim].[Hier].[El]`, and for the default hierarchy also `[Dim].[El]`.
 * Case-insensitive on the names (the regex runs with `i`).
 */
const refPattern = (key: string, el: string) => {
  const { dim, hier } = splitHierKey(key);
  const h = `\\.\\[${escapeRegex(esc(hier))}\\]`;
  const hierPart = hier === dim ? `(?:${h})?` : h;
  return `\\[${escapeRegex(esc(dim))}\\]${hierPart}\\.\\[${escapeRegex(esc(el))}\\]`;
};

/** Our own members: `MEMBER <ref "X (Format)"> AS <ref "X">, FORMAT_STRING = '…'[, CAPTION = '…']` */
const OWN_MEMBER = /MEMBER\s+(\[[^\]]*(?:]][^\]]*)*\](?:\.\[[^\]]*(?:]][^\]]*)*\])*)\s+AS\s+(\[[^\]]*(?:]][^\]]*)*\](?:\.\[[^\]]*(?:]][^\]]*)*\])*)\s*,\s*FORMAT_STRING\s*=\s*'((?:[^']|'')*)'(?:\s*,\s*CAPTION\s*=\s*'(?:[^']|'')*')?\s*/gi;

const lastPart = (ref: string) => {
  const m = /\[((?:[^\]]|]])*)\]$/.exec(ref);
  return m ? m[1].replace(/]]/g, ']') : '';
};
/** Viewer key of a member ref: `[D].[H].[El]` → `hierKey(D, H)`, `[D].[El]` → `D`. */
const keyOf = (ref: string) => {
  const parts = [...ref.matchAll(/\[((?:[^\]]|]])*)\]/g)].map((m) => m[1].replace(/]]/g, ']'));
  return parts.length >= 3 ? hierKey(parts[0], parts[1]) : (parts[0] ?? '');
};

/**
 * Same length as `mdx`, with comments blanked and the insides of `[names]`
 * and string literals filled with `_`, so a keyword search only finds
 * keywords: not `SELECT` in `[SELECT]`, not `WITH` behind a comment.
 */
function maskMdx(mdx: string): string {
  let out = '';
  for (let i = 0; i < mdx.length;) {
    const two = mdx.slice(i, i + 2);
    let end = i + 1;
    let fill = '';
    if (two === '/*') {
      const e = mdx.indexOf('*/', i + 2);
      end = e < 0 ? mdx.length : e + 2;
      fill = ' ';
    } else if (two === '//' || two === '--') {
      const e = mdx.indexOf('\n', i);
      end = e < 0 ? mdx.length : e;
      fill = ' ';
    } else if (mdx[i] === '[' || mdx[i] === "'" || mdx[i] === '"') {
      // `]]`, `''`, `""` escape the closing character.
      const close = mdx[i] === '[' ? ']' : mdx[i];
      end = i + 1;
      while (end < mdx.length && !(mdx[end] === close && mdx[end + 1] !== close)) { end += mdx[end] === close ? 2 : 1; }
      end = Math.min(end + 1, mdx.length);
      out += mdx[i] + '_'.repeat(Math.max(0, end - i - 2)) + (end - i > 1 ? mdx[end - 1] : '');
      i = end;
      continue;
    }
    out += fill ? fill.repeat(end - i) : mdx.slice(i, end);
    i = end;
  }
  return out;
}

/**
 * Split `WITH ...` from the rest: `lead` is what stands before `WITH`
 * (comments, whitespace) and goes back in front unchanged, `withBody` the
 * member definitions, `rest` the query from `SELECT` on.
 */
function splitWith(mdx: string): { lead: string; withBody: string; rest: string } {
  const masked = maskMdx(mdx);
  const m = /^\s*WITH\b/i.exec(masked);
  if (!m) { return { lead: '', withBody: '', rest: mdx }; }
  const sel = /\bSELECT\b/i.exec(masked);
  if (!sel) { return { lead: '', withBody: '', rest: mdx }; }
  return { lead: mdx.slice(0, m[0].length - 4), withBody: mdx.slice(m[0].length, sel.index), rest: mdx.slice(sel.index) };
}

/** The part of a SELECT that holds the axes: up to FROM. */
function axesEnd(rest: string): number {
  const f = /\bFROM\b/i.exec(maskMdx(rest));
  return f ? f.index : rest.length;
}

export function embedDisplayFormats(mdx: string, formats: DisplayFormats): EmbedResult {
  const split = splitWith(mdx);
  const { lead } = split;
  let { withBody, rest } = split;
  const skipped: EmbedResult['skipped'] = [];
  const defs: string[] = [];

  // Our members from an earlier save: `X (Format)` → its format and target.
  const own = new Map<string, { target: string; fmt: string }>();
  withBody = withBody.replace(OWN_MEMBER, (all, name: string, target: string, fmt: string) => {
    const n = lastPart(name);
    if (!n.endsWith(FORMAT_SUFFIX) || n.slice(0, -FORMAT_SUFFIX.length) !== lastPart(target)
      || keyOf(name).toLowerCase() !== keyOf(target).toLowerCase()) { return all; }
    own.set(name, { target, fmt: fmt.replace(/''/g, "'") });
    return '';
  });

  for (const [dim, byEl] of Object.entries(formats)) {
    for (const [elRaw, fmt] of Object.entries(byEl)) {
      // A format set on our own member in the grid belongs to its target.
      // The suffix alone does not make a member ours: a real element may be
      // called `X (Format)` too.
      const ownName = [...own.keys()].find((k) => keyOf(k).toLowerCase() === dim.toLowerCase()
        && (lastPart(k) === elRaw || lastPart(own.get(k)!.target) === elRaw));
      if (ownName) { own.get(ownName)!.fmt = fmt; continue; }
      const el = elRaw;
      const end = axesEnd(rest);
      // Only a plain set item: `{` or `,` before, `,` or `}` after.
      const item = new RegExp(`([{,]\\s*)(${refPattern(dim, el)})(?=\\s*[,}])`, 'gi');
      const axes = rest.slice(0, end);
      // The query already names a real `X (Format)`: our member would collide with it.
      const taken = new RegExp(refPattern(dim, el + FORMAT_SUFFIX), 'i').test(rest);
      if (taken || !item.test(axes)) { skipped.push({ dim, element: el }); continue; }
      const h = hierMdxRef(dim);
      const name = `${h}.[${esc(el + FORMAT_SUFFIX)}]`;
      rest = axes.replace(item, (_a, pre: string) => pre + name) + rest.slice(end);
      own.set(name, { target: `${h}.[${esc(el)}]`, fmt });
    }
  }

  for (const [name, { target, fmt }] of own) {
    const caption = lastPart(target);
    defs.push(`MEMBER ${name} AS ${target}, FORMAT_STRING = '${escQ(fmt)}', CAPTION = '${escQ(caption)}'`);
  }
  const others = withBody.trim();
  if (!defs.length && !others) { return { mdx: lead + rest, skipped }; }
  return { mdx: `${lead}WITH ${[...defs, others].filter(Boolean).join('\n ')}\n${rest}`, skipped };
}

export interface UnwrapResult {
  mdx: string;
  formats: DisplayFormats;
}

/**
 * The reverse of `embedDisplayFormats`: drop our own format members, put the
 * original elements back into the sets, return their formats. MDX without
 * such members comes back unchanged with no formats.
 */
export function unwrapDisplayFormats(mdx: string): UnwrapResult {
  const formats: DisplayFormats = {};
  const { lead, withBody, rest } = splitWith(mdx);
  if (!withBody) { return { mdx, formats }; }
  const swaps: Array<[string, string]> = [];
  const kept = withBody.replace(OWN_MEMBER, (all, name: string, target: string, fmt: string) => {
    const n = lastPart(name);
    const el = lastPart(target);
    const dim = keyOf(target);
    if (!n.endsWith(FORMAT_SUFFIX) || n.slice(0, -FORMAT_SUFFIX.length) !== el
      || keyOf(name).toLowerCase() !== dim.toLowerCase()) { return all; }
    (formats[dim] ??= {})[el] = fmt.replace(/''/g, "'");
    swaps.push([name, target]);
    return '';
  });
  if (!swaps.length) { return { mdx, formats }; }
  let body = rest;
  let others = kept.trim();
  // Other definitions may build on our member (`[Double] AS [X (Format)] * 2`).
  for (const [name, target] of swaps) {
    body = body.split(name).join(target);
    others = others.split(name).join(target);
  }
  return { mdx: lead + (others ? `WITH ${others}\n${body}` : body), formats };
}
