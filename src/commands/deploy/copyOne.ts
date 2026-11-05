// src/commands/deploy/copyOne.ts
//
// ONE object from one server to another — one path per kind, in one place.
//
// Why this file exists: the same chain used to stand in the tree three
// times. The view copy (`cubeExists → readViewForCopy → oversized/unreadable
// → subsetExists per reference → probeViewKind → writeViewCopy`) sat word
// for word in `tree/deployViewsSubsets.ts` and in `deploy/deployObjects.ts`,
// and clearing out the OData meta fields plus the process mapping even sat
// in three places (`processEditor/deployToServer.ts` twice, `deployObjects.ts`
// once). The header of `deployObjects.ts` claimed the write paths were "not
// reinvented" — they had been copied. Every TM1 quirk in this chain (a
// view's type change, alias loss, the flatten confirmation prompt) therefore
// had to be re-applied in three places.
//
// What does NOT belong here: the question of WHAT should be transferred, and
// the check that comes before it. That lives in `deployCheck.ts` and works on
// sets, without side effects.
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { cubeExists, probeViewKind } from '../../tm1Rest/cubeApi';
import { getProcess, PROCESS_FULL_SELECT } from '../../tm1Rest/processApi';
import { getSubset, listSubsetElementNames, subsetExists } from '../../tm1Rest/subsetApi';
import { readViewForCopy, writeViewCopy } from '../../tm1Rest/viewCopyApi';
import { mergeVariableColumns } from '../../utils/processVariablesUi';
import {
  saveSubset, saveExpressionSubset, SAVE_CANCELLED, type FlattenChoice,
} from '../dimension/dimensionSubsetSave';
import type { DataSource, ProcessParameter, ProcessVariable, TiSections } from '../../tm1Client';

/** Shown after a copy left an ODBC password out; `{0}` = process name(s). */
export function odbcPasswordNotCopiedText(names: string): string {
  return vscode.l10n.t('The ODBC password was not copied: TM1 encrypts it per server. Processes that already existed on the target keep their own password; set it on new ones: {0}', names);
}

const lc = (s: string): string => s.toLowerCase();

const META_KEYS_RE = /^@odata\./;

/** OData meta fields out: `@odata.type` in a PATCH body tips over the call. */
export function stripODataMeta<T extends Record<string, unknown>>(
  obj: T | undefined | null,
): T | undefined {
  if (!obj || typeof obj !== 'object') { return undefined; }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!META_KEYS_RE.test(k)) { out[k] = v; }
  }
  return out as T;
}

/** A process, broken down into what `deployProcess` accepts. */
export interface ProcessCopy {
  sections: TiSections;
  dataSource: DataSource | undefined;
  parameters: ProcessParameter[];
  variables: ProcessVariable[];
  /** State of the Architect assistants, when the source carries one. */
  uiData: string | undefined;
  /** The SOURCE's security flag. Whether it travels along is decided by the caller. */
  hasSecurity: boolean | undefined;
  /** The source had an ODBC password that was left out (see `readProcessForCopy`). */
  odbcPasswordDropped: boolean;
}

/**
 * Read a process and prepare it for writing.
 *
 * `PROCESS_FULL_SELECT` instead of `$select=*`: the star SHORTENS complex
 * types, and without `VariablesUIData` and `UIData` the copy loses the
 * ignore markers of the source columns and the state of the Architect
 * assistants. TM1 never reconciles `VariablesUIData` with `Variables` —
 * `mergeVariableColumns` merges the two, because they only mean something
 * together.
 */
export async function readProcessForCopy(cfg: Tm1Config, name: string): Promise<ProcessCopy> {
  const src = await getProcess(cfg, name, { select: PROCESS_FULL_SELECT });
  // The ODBC password ciphertext is bound to its server: the target does not
  // recognise it and encrypts it AGAIN as plaintext, so the copy silently gets a
  // wrong password (live 11.8 → 11.8, 2026-10-27). Leaving it out lets the
  // DataSource merge keep the target's own password on an overwrite.
  const dataSource = stripODataMeta(src.DataSource as Record<string, unknown> | undefined);
  const odbcPasswordDropped = !!dataSource && typeof dataSource.password === 'string' && dataSource.password !== '';
  if (dataSource) { delete dataSource.password; }
  return {
    sections: {
      prolog: (src.PrologProcedure as string | undefined) ?? '',
      metadata: (src.MetadataProcedure as string | undefined) ?? '',
      data: (src.DataProcedure as string | undefined) ?? '',
      epilog: (src.EpilogProcedure as string | undefined) ?? '',
    },
    dataSource: dataSource as DataSource | undefined,
    parameters: ((src.Parameters as ProcessParameter[] | undefined) ?? [])
      .map(p => stripODataMeta(p as unknown as Record<string, unknown>) as unknown as ProcessParameter),
    variables: mergeVariableColumns(
      ((src.Variables as ProcessVariable[] | undefined) ?? [])
        .map(v => stripODataMeta(v as unknown as Record<string, unknown>) as unknown as ProcessVariable),
      src.VariablesUIData as string[] | undefined,
    ),
    uiData: typeof src.UIData === 'string' && src.UIData.length > 0 ? src.UIData : undefined,
    hasSecurity: typeof src.HasSecurityAccess === 'boolean' ? src.HasSecurityAccess : undefined,
    odbcPasswordDropped,
  };
}

/**
 * What is already known when copying a view.
 *
 * Without this information, the write path asks live — once per cube and
 * once per named subset reference. After a check step that has already read
 * the target's inventory as sets anyway, those are nothing but calls
 * answering a question that has already been answered: hundreds of them at
 * 200 views.
 *
 * DELIBERATELY NOT included: the read source view itself. Passing it through
 * would save the second `readViewForCopy`, but it would keep the POST body
 * of EVERY checked view in memory at the same time — for anonymous axes,
 * that is the element list. Reading twice is cheaper than a memory pile-up,
 * as long as nobody has measured the opposite.
 */
export interface KnownTarget {
  /** Target's cubes, lowercased. */
  cubes?: ReadonlySet<string>;
  /** Target's subsets as `dim|hier|name`, lowercased. */
  subsets?: ReadonlySet<string>;
}

/**
 * Transfer a view.
 *
 * The order is not arbitrary: first the cube, then readability, then the
 * references, then the write. Every one of these questions has its own
 * message — without them, every failure would be a bare HTTP 404 on a path
 * nobody has read.
 */
export async function copyViewToServer(
  srcCfg: Tm1Config,
  tgtCfg: Tm1Config,
  cube: string,
  view: string,
  isPrivate: boolean,
  known: KnownTarget = {},
): Promise<void> {
  const cubeThere = known.cubes ? known.cubes.has(lc(cube)) : await cubeExists(tgtCfg, cube);
  if (!cubeThere) {
    throw new Error(vscode.l10n.t('Cube "{0}" does not exist on the target server.', cube));
  }

  const src = await readViewForCopy(srcCfg, cube, view, isPrivate, view);
  if (!src) { throw new Error(vscode.l10n.t('View "{0}" could not be read.', view)); }
  if (src.kind === 'other') {
    throw new Error(vscode.l10n.t('View "{0}" has a type this version cannot copy.', view));
  }
  if (src.plan) {
    // Either one would be a different view from the one that stands here —
    // better to name it than to silently write something smaller.
    if (src.plan.oversized.length > 0) {
      throw new Error(vscode.l10n.t(
        'Axis of "{0}" holds too many members to be copied ({1}).',
        view, src.plan.oversized.join(', ')));
    }
    if (src.plan.unreadable > 0) {
      throw new Error(vscode.l10n.t('An axis entry of "{0}" could not be read.', view));
    }
    // A named subset is written as a REFERENCE. If it is missing over there,
    // the POST fails — with this check, the reason is stated in the text.
    for (const ref of src.plan.namedSubsets) {
      const there = known.subsets
        ? known.subsets.has(`${lc(ref.dim)}|${lc(ref.hier)}|${lc(ref.name)}`)
        : await subsetExists(tgtCfg, ref.dim, ref.hier, ref.name, false);
      if (!there) {
        throw new Error(vscode.l10n.t(
          'Subset "{0}" of dimension "{1}" does not exist on the target server.', ref.name, ref.dim));
      }
    }
  }
  const existingKind = await probeViewKind(tgtCfg, cube, view, isPrivate);
  await writeViewCopy(tgtCfg, cube, view, isPrivate, src, existingKind,
    vscode.l10n.t('View "{0}" could not be written.', view),
    vscode.l10n.t('View "{0}" has no readable axes and was not written.', view));
}

/**
 * Transfer a subset.
 *
 * Dynamic stays dynamic — computing the members and writing them as a list
 * would turn a rule into a snapshot. `saveSubset` asks for confirmation for
 * a subset that is to be written flat; a no there means `cancelled`, and no
 * report may count that as a success.
 */
export async function copySubsetToServer(
  srcCfg: Tm1Config,
  tgtCfg: Tm1Config,
  dim: string,
  hier: string,
  name: string,
  isPrivate: boolean,
  overwrite: boolean,
  /**
   * What should happen to a DYNAMIC subset on the target. The single-item
   * command asks per item (`ask`), the bulk run has already asked the
   * question once beforehand.
   */
  flatten: FlattenChoice = 'ask',
): Promise<'written' | 'cancelled'> {
  const detail = await getSubset(srcCfg, dim, hier, name, isPrivate);
  if (!detail.ok) { throw new Error(vscode.l10n.t('Subset "{0}" could not be read.', name)); }
  const alias = detail.Alias ? String(detail.Alias) : null;
  const expression = String(detail.Expression ?? '').trim();
  if (expression) {
    await saveExpressionSubset(dim, hier, name, isPrivate, expression, overwrite, tgtCfg, alias);
    return 'written';
  }
  const list = await listSubsetElementNames(srcCfg, dim, hier, name, isPrivate, 60000);
  if (!list.complete) {
    throw new Error(vscode.l10n.t('Members of subset "{0}" could not be read completely.', name));
  }
  const res = await saveSubset(
    dim, hier, name, isPrivate, list.elements, overwrite, tgtCfg, alias, flatten);
  return res === SAVE_CANCELLED ? 'cancelled' : 'written';
}
