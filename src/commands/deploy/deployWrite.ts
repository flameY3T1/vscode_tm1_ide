// src/commands/deploy/deployWrite.ts
//
// The write path of a run: one call per kind, plus the return value that
// distinguishes between "written", "cancelled" and "written, but not
// complete".
//
// The chains themselves are NOT here, nor reinvented: process, view and
// subset go through `copyOne.ts` the same way the individual tree commands
// do, chores go through `chore/choreSavePure.ts` with its fallback. All that
// is here is which path applies to which kind — and what a chore needs when
// it does not exist over there yet.
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getCubeRules, updateCubeRules } from '../../tm1Rest/cubeApi';
import { deployProcess, getProcessParameters, type Tm1Parameter } from '../../tm1Rest/processApi';
import {
  createChore, updateChore, clearChoreTasks, getChoreDetail,
} from '../../tm1Rest/choreApi';
import { mapChoreDetailFromApi } from '../chore/choreEditorPure';
import { saveChore, saveChoreAs, type ChoreSaveDeps } from '../chore/choreSavePure';
import type { ChoreDetail } from '../../webviewClient/choreEditor/protocol';
import {
  copySubsetToServer, copyViewToServer, odbcPasswordNotCopiedText, readProcessForCopy, type KnownTarget,
} from './copyOne';
import type { FlattenChoice } from '../dimension/dimensionSubsetSave';
import type { DeployItem } from './deployCheck';

/** Transfer the rule text. `…/Rules` only exists for reading; writing happens on the cube. */
async function copyRules(srcCfg: Tm1Config, tgtCfg: Tm1Config, cube: string): Promise<void> {
  const rules = await getCubeRules(srcCfg, cube);
  if (!rules.trim()) {
    throw new Error(vscode.l10n.t('Cube "{0}" has no rules to deploy.', cube));
  }
  await updateCubeRules(tgtCfg, cube, rules,
    vscode.l10n.t('Rules of "{0}" could not be written.', cube));
}

/** The REST hooks of chore saving, bound to the TARGET server. */
function choreDeps(cfg: Tm1Config): ChoreSaveDeps {
  return {
    createChore: body => createChore(cfg, body),
    updateChore: (name, body) => updateChore(cfg, name, body),
    clearChoreTasks: name => clearChoreTasks(cfg, name),
    readChore: name => readChoreDetail(cfg, name),
    readProcessParams: async name => (await getProcessParameters(cfg, name))
      .map((p: Tm1Parameter) => ({ name: p.Name, type: String(p.Type) })),
  };
}

async function readChoreDetail(cfg: Tm1Config, name: string): Promise<ChoreDetail> {
  const { data } = await getChoreDetail(cfg, name);
  return mapChoreDetailFromApi(data as unknown as Parameters<typeof mapChoreDetailFromApi>[0]);
}

/**
 * Transfer a chore.
 *
 * New over there: `saveChoreAs` — POST inactive, activate afterward.
 * Existing: `saveChore` with its fallback, because PATCH APPENDS tasks and
 * tasks can only be changed on an inactive chore. Both are already built in
 * `choreSavePure.ts`; a write path of its own here would be the same dance a
 * second time, without the fallback.
 */
async function copyChore(
  srcCfg: Tm1Config, tgtCfg: Tm1Config, name: string, exists: boolean,
): Promise<DeployResult> {
  const detail = await readChoreDetail(srcCfg, name);
  const deps = choreDeps(tgtCfg);
  if (exists) {
    // Both write paths REPORT partial failures instead of throwing: written
    // is written. Discarding them would turn "created, but not activated"
    // into an unqualified success message.
    const res = await saveChore(deps, { isNew: false, originalName: name, choreData: detail });
    if (res.readBackError) {
      return { warn: vscode.l10n.t(
        'Chore "{0}" was written, but the read-back failed: {1}', name, res.readBackError) };
    }
    if (res.storedTasks !== res.sentTasks) {
      return { warn: vscode.l10n.t(
        'Chore "{0}": {1} of {2} tasks are on the target server.',
        name, String(res.storedTasks), String(res.sentTasks)) };
    }
    return 'written';
  }
  const res = await saveChoreAs(deps, { targetName: name, choreData: detail });
  if (detail.Active && !res.activated) {
    return { warn: vscode.l10n.t(
      'Chore "{0}" was created, but not activated: {1}', name, res.activateError ?? '') };
  }
  return 'written';
}

/**
 * What a single item left behind. `{ warn }` means: written, but not
 * complete — that belongs neither under "error" nor under a plain success
 * message.
 */
export type DeployResult = 'written' | 'cancelled' | { warn: string };

/**
 * Transfer one item. `cancelled` means: the user cancelled at a confirmation
 * prompt, NOTHING was written — no report may count that as a success.
 */
export async function deployOne(
  item: DeployItem,
  srcCfg: Tm1Config,
  tgtCfg: Tm1Config,
  existsOnTarget: boolean,
  /**
   * The target's already-read inventory. If it is missing, the view copy
   * asks live instead — once per cube and once per named subset reference.
   */
  known: KnownTarget = {},
  /**
   * What should happen to a DYNAMIC subset on the target. The bulk run
   * answers the question once beforehand; `ask` here would mean up to one
   * modal confirmation prompt per subset in the middle of the run.
   */
  flatten: FlattenChoice = 'ask',
): Promise<DeployResult> {
  switch (item.kind) {
    case 'process': {
      const src = await readProcessForCopy(srcCfg, item.name);
      await deployProcess(item.name, src.sections, src.dataSource, src.parameters,
        src.variables, tgtCfg, src.hasSecurity, src.uiData);
      return src.odbcPasswordDropped ? { warn: odbcPasswordNotCopiedText(item.name) } : 'written';
    }
    case 'rule':
      await copyRules(srcCfg, tgtCfg, item.name);
      return 'written';
    case 'chore':
      return copyChore(srcCfg, tgtCfg, item.name, existsOnTarget);
    case 'view':
      // Public, not private: the page does not list `PrivateViews`.
      await copyViewToServer(srcCfg, tgtCfg, item.parent ?? '', item.name, false, known);
      return 'written';
    case 'subset':
      return copySubsetToServer(srcCfg, tgtCfg, item.parent ?? '',
        item.hierarchy ?? item.parent ?? '', item.name, false, true, flatten);
  }
}
