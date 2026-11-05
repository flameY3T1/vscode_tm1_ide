/**
 * Runtime read-capture instrumentation.
 *
 * Cell/attribute READS resolve their cube + coordinates from VARIABLES at run
 * time, so static analysis cannot know which cells a process touches. Because
 * these reads are side-effect-free, we can re-invoke them purely to log what
 * they returned: before every statement that contains a read call, we emit an
 * `ASCIIOutput(<log>, '__CELLREAD__', <retType>, <cube>, <coords…>, <value>)`
 * line that re-runs the read with the same (live-resolved) arguments. The
 * capture's live run then records the real cube name + coordinates + value,
 * which the importer turns into cube-cell fixtures for the simulator.
 *
 * Runs AFTER the write-rewriter (tiSourceRewriter) so the ASCIIOutput markers
 * this pass emits are not themselves rewritten.
 *
 * Reads nested inside another call's arguments, an expression, or a
 * loop/condition guard ARE captured: we recurse into every call's argument
 * string (at any depth) and insert the marker before the ENCLOSING top-level
 * statement. Because arguments are bound before the statement executes, the
 * re-invoked read resolves to the same values. A read used only inside a loop
 * guard (`WHILE(CellGetN(...) > 0)`) is therefore logged once with the values
 * bound at loop entry, not per iteration — an accepted limitation. Reads in
 * ordinary per-row statements (assignments in the Data tab) are logged every
 * time the statement runs.
 */

import { findCallSites, splitArgs } from './tiSourceLexer';

/** Cell/cube read builtins whose (cube, coords)→value we capture at runtime. */
export const CELL_READ_FUNC_NAMES: ReadonlySet<string> = new Set([
  'cellgetn',
  'cellgets',
  'cellvaluen',
  'cellvalues',
  'cubegetn',
  'cubegets',
]);

/** true for the numeric-returning reads (value must be stringified for ASCIIOutput). */
const isNumericRead = (lower: string): boolean =>
  lower === 'cellgetn' || lower === 'cellvaluen' || lower === 'cubegetn';

/** Object-level attribute-read builtins whose (object-ids, attr, locale?)→value we
 *  capture at runtime. Side-effect-free like cell reads, so re-invoking to log is
 *  safe. Captured into a SEPARATE `__ATTRREAD__` marker (funcName + all args). */
export const ATTR_READ_FUNC_NAMES: ReadonlySet<string> = new Set([
  'choreattrn',
  'choreattrnl',
  'choreattrs',
  'choreattrsl',
  'cubeattrn',
  'cubeattrnl',
  'cubeattrs',
  'cubeattrsl',
  'dimensionattrnl',
  'dimensionattrsl',
  'hierarchyattrn',
  'hierarchyattrnl',
  'hierarchyattrs',
  'hierarchyattrsl',
  'hierarchysubsetattrn',
  'hierarchysubsetattrnl',
  'hierarchysubsetattrs',
  'hierarchysubsetattrsl',
  'processattrn',
  'processattrnl',
  'processattrs',
  'processattrsl',
  'subsetattrn',
  'subsetattrnl',
  'subsetattrs',
  'subsetattrsl',
  'viewattrn',
  'viewattrnl',
  'viewattrs',
  'viewattrsl',
]);

/** CubeRuleGet: rule text spans lines and cannot go into the CSV log, so the
 *  marker carries only cube + LONG(text); capture fetches the text over REST
 *  afterwards and keeps it only when the length matches (`__RULEREAD__`). */
const RULE_READ = 'cuberuleget';

/** retType for an attribute read: 'N' for names ending N/NL, 'S' for S/SL. */
const attrRetType = (lower: string): 'N' | 'S' =>
  (/n(l)?$/.test(lower) ? 'N' : 'S');

/** Offset of the start of the statement that encloses `pos` — the first
 *  non-whitespace char after the previous top-level `;` (or start of source).
 *
 *  A raw backward scan for `;` is not enough: a `;` inside a string literal
 *  (`'A;B'`) or a comment (`# skip a;b`) is NOT a statement boundary. We scan
 *  FORWARD from the start tracking string/line-comment/block-comment state (the
 *  same lexical rules as tiSourceLexer) and remember the offset just past the
 *  last real `;` seen before `pos`. */
function statementStart(src: string, pos: number): number {
  let boundary = 0; // offset just past the last top-level ';' before pos
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < pos; i++) {
    const c = src[i];
    const n = src[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (c === "'") {
        if (n === "'") {
          i++; // doubled '' escape stays inside the string
          continue;
        }
        inString = false;
      }
      continue;
    }

    if (c === '#') {
      inLineComment = true;
      continue;
    }
    if (c === '/' && n === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === "'") {
      inString = true;
      continue;
    }
    if (c === ';') {
      boundary = i + 1;
    }
  }

  let start = boundary;
  while (start < pos && /\s/.test(src[start])) start++;
  return start;
}

/** Collect every cell/cube read reachable from `site` — the site itself if it is
 *  a read, plus (recursively) any read nested inside its argument list. Mirrors
 *  the `eachCallDeep` recursion in commands/tiTest/helpers.ts so reads wrapped in
 *  another call, an expression, or an IF/WHILE guard are not missed. */
type CollectedRead = { name: string; args: string[]; kind: 'cell' | 'attr' | 'rule' };

function collectReads(site: { name: string; argString: string }): CollectedRead[] {
  const out: CollectedRead[] = [];
  const lower = site.name.toLowerCase();
  if (CELL_READ_FUNC_NAMES.has(lower)) {
    const args = splitArgs(site.argString).map((a) => a.trim());
    if (args.length >= 2) out.push({ name: site.name, args, kind: 'cell' }); // need cube + one coord
  } else if (ATTR_READ_FUNC_NAMES.has(lower)) {
    const args = splitArgs(site.argString).map((a) => a.trim());
    if (args.length >= 2) out.push({ name: site.name, args, kind: 'attr' }); // need object-id + attr
  } else if (lower === RULE_READ) {
    const args = splitArgs(site.argString).map((a) => a.trim());
    if (args.length === 1) out.push({ name: site.name, args, kind: 'rule' });
  }
  for (const nested of findCallSites(site.argString)) {
    out.push(...collectReads(nested));
  }
  return out;
}

export function instrumentReads(source: string, logFileVar: string): string {
  const inserts: { pos: number; text: string }[] = [];

  for (const site of findCallSites(source)) {
    const reads = collectReads(site);
    if (reads.length === 0) continue;

    // All reads inside a top-level statement share the same insertion point:
    // the statement start. Arguments are bound before the statement runs, so the
    // re-invoked read resolves to the same values (a loop-guard read is captured
    // once at loop entry).
    const pos = statementStart(source, site.start);
    for (const read of reads) {
      const lower = read.name.toLowerCase();
      const reInvoke = `${read.name}(${read.args.join(', ')})`;
      if (read.kind === 'cell') {
        const retType = isNumericRead(lower) ? 'N' : 'S';
        const value = retType === 'N' ? `NumberToString(${reInvoke})` : reInvoke;
        const fields = [`'__CELLREAD__'`, `'${retType}'`, ...read.args, value].join(', ');
        inserts.push({ pos, text: `ASCIIOutput(${logFileVar}, ${fields});\n` });
      } else if (read.kind === 'rule') {
        // Rule read: __RULEREAD__ , cube , LONG(rule text).
        const fields = [`'__RULEREAD__'`, read.args[0], `NumberToString(LONG(${reInvoke}))`].join(', ');
        inserts.push({ pos, text: `ASCIIOutput(${logFileVar}, ${fields});\n` });
      } else {
        // Attribute read: __ATTRREAD__ , retType , funcName , all args , value.
        const retType = attrRetType(lower);
        const value = retType === 'N' ? `NumberToString(${reInvoke})` : reInvoke;
        const fields = [
          `'__ATTRREAD__'`,
          `'${retType}'`,
          `'${read.name}'`,
          ...read.args,
          value,
        ].join(', ');
        inserts.push({ pos, text: `ASCIIOutput(${logFileVar}, ${fields});\n` });
      }
    }
  }

  if (inserts.length === 0) return source;
  inserts.sort((a, b) => a.pos - b.pos);

  let out = '';
  let cursor = 0;
  for (const ins of inserts) {
    out += source.slice(cursor, ins.pos) + ins.text;
    cursor = ins.pos;
  }
  return out + source.slice(cursor);
}
