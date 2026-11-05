/**
 * Top-level rewrite engine: scan TI source, find every write-call (per
 * tiRewriteMapping whitelist), and put the corresponding TextOutput logging
 * call in front of it. Emits a `WriteTargets` summary so the manifest can
 * record which cubes/dims this process is expected to touch.
 *
 * Design notes:
 *  - Operates on already-paren-joined source. The caller is responsible for
 *    running joinContinuationLines first if multi-line statements are present.
 *  - Capture is a full live run (decided 2026-10-20): every write is logged AND
 *    left in place, nothing is stripped or blocked. A mutation without a
 *    mapping simply runs and stays invisible to the diff.
 */

import { findCallSites, splitArgs } from './tiSourceLexer';
import { findMapping, emitTextOutput, type WriteCallMapping } from './tiRewriteMapping';

export type WriteTargets = {
  cubes: string[];
  dimensions: string[];
};

export type RewriteResult = {
  rewritten: string;
  writeTargets: WriteTargets;
  rewrittenCalls: string[];
  subProcessCalls: string[];
};

const SUB_PROCESS_FUNCS = new Set(['executeprocess', 'executecommand']);

/** Literal or plain variable: evaluating it twice yields the same value. */
const STABLE_ARG = /^\s*('([^']|'')*'|-?\d+(\.\d+)?|[A-Za-z_][A-Za-z0-9_.]*)\s*$/;

/**
 * The marker and the live call must see the SAME value: `CellPutN(RAND(), …)`
 * would otherwise log one random number and write another. Every non-stable
 * argument the marker uses is evaluated once into a helper variable. The helper's
 * type is read off the mapping (wrapped in NumberToString = numeric), and the
 * N/S tag in its name keeps one name one type across all four sections.
 */
function hoistArgs(
  mapping: WriteCallMapping,
  args: string[],
  prefix: string,
  next: () => number,
): { assigns: string; args: string[] } | null {
  const probe = mapping.buildArgs(args.map((_, i) => `\u0001${i}\u0001`)).join('\u0002');
  let assigns = '';
  const out = args.map((a, i) => {
    const tok = `\u0001${i}\u0001`;
    if (STABLE_ARG.test(a) || !probe.includes(tok)) { return a; }
    const v = `${probe.includes(`NumberToString(${tok})`) ? 'n' : 's'}${prefix}${next()}`;
    assigns += `${v} = ${a.trim()};\n`;
    return v;
  });
  return assigns ? { assigns, args: out } : null;
}

function unquote(arg: string | undefined): string | null {
  if (!arg) return null;
  const t = arg.trim();
  if (t.length < 2) return null;
  if (t[0] !== "'" || t[t.length - 1] !== "'") return null;
  return t.slice(1, -1).replace(/''/g, "'");
}

function classifyWriteTarget(
  funcName: string,
  rawArgs: string[],
  targets: { cubes: Set<string>; dimensions: Set<string> },
) {
  const lower = funcName.toLowerCase();

  // Cubes
  if (lower === 'cellputn' || lower === 'cellputs' || lower === 'cellincrementn') {
    const cube = unquote(rawArgs[1]);
    if (cube) targets.cubes.add(cube);
    return;
  }
  if (lower === 'viewzeroout' || lower === 'viewcreate') {
    const cube = unquote(rawArgs[0]);
    if (cube) targets.cubes.add(cube);
    return;
  }
  if (lower === 'cubecreate') {
    const cube = unquote(rawArgs[0]);
    if (cube) targets.cubes.add(cube);
    return;
  }

  // Dimensions (default hierarchy)
  if (
    lower === 'dimensionelementinsert' ||
    lower === 'dimensionelementdelete' ||
    lower === 'dimensionelementcomponentadd' ||
    lower === 'subsetcreate' ||
    lower === 'subsetcreatebymdx' ||
    lower === 'subsetelementinsert' ||
    lower === 'subsetdeleteallelements'
  ) {
    const dim = unquote(rawArgs[0]);
    if (dim) targets.dimensions.add(dim);
    return;
  }
  if (lower === 'attrputs' || lower === 'attrputn') {
    const dim = unquote(rawArgs[1]);
    if (dim) targets.dimensions.add(dim);
    return;
  }

  // Hierarchy-named variants
  if (
    lower === 'hierarchyelementinsert' ||
    lower === 'hierarchyelementdelete' ||
    lower === 'hierarchyelementcomponentadd'
  ) {
    const dim = unquote(rawArgs[0]);
    if (dim) targets.dimensions.add(dim);
    return;
  }
  if (lower === 'elementattrputs' || lower === 'elementattrputn') {
    const dim = unquote(rawArgs[1]);
    if (dim) targets.dimensions.add(dim);
    return;
  }

  if (lower === 'dimensioncreate') {
    const dim = unquote(rawArgs[0]);
    if (dim) targets.dimensions.add(dim);
    return;
  }
}

export function rewriteSource(source: string, logFileVar: string): RewriteResult {
  const sites = findCallSites(source);

  const targets = { cubes: new Set<string>(), dimensions: new Set<string>() };
  const rewrittenCalls = new Set<string>();
  const subProcessCalls = new Set<string>();

  const out: string[] = [];
  let cursor = 0;
  let prefix = 'TiTestCap';
  while (source.toLowerCase().includes(prefix.toLowerCase())) { prefix += 'X'; }
  let hoisted = 0;

  for (const site of sites) {
    const lower = site.name.toLowerCase();

    if (SUB_PROCESS_FUNCS.has(lower)) {
      subProcessCalls.add(site.name);
    }

    const mapping = findMapping(site.name);
    if (!mapping) { continue; }

    // Marker for the diff, then the original call so it runs for real.
    const rawArgs = splitArgs(site.argString);
    classifyWriteTarget(site.name, rawArgs, targets);
    const hoist = hoistArgs(mapping, rawArgs, prefix, () => ++hoisted);
    const args = hoist?.args ?? rawArgs;
    out.push(source.slice(cursor, site.start));
    if (hoist) { out.push(hoist.assigns); }
    out.push(emitTextOutput(mapping, args, logFileVar));
    out.push(';\n');
    out.push(hoist ? `${site.name}(${args.join(', ')})` : source.slice(site.start, site.end));
    rewrittenCalls.add(lower);
    cursor = site.end;
  }

  out.push(source.slice(cursor));

  return {
    rewritten: out.join(''),
    writeTargets: {
      cubes: [...targets.cubes].sort(),
      dimensions: [...targets.dimensions].sort(),
    },
    rewrittenCalls: [...rewrittenCalls].sort(),
    subProcessCalls: [...subProcessCalls].sort(),
  };
}
