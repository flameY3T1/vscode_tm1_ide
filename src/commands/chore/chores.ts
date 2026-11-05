import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import {
  listChores,
  setChoreActive as setChoreActiveApi,
  executeChore as executeChoreApi,
  type Tm1Chore,
} from '../../tm1Rest/choreApi';
import { pickDeployTarget } from '../processEditor/deploy';
import { runCancellableExecution } from '../../runState/runCancellableProcess';
import { buildChoreQuickPickItems, buildChoreActionItems } from './choresPure';
import { errMsg } from '../../utils/errMsg';
import { outputChannel } from '../../utils/outputChannel';

// Lazy and merged by name — created only on first access, and two modules
// with the same name share one channel.
const out = outputChannel('TM1 Chores');

type Chore = Tm1Chore;

async function fetchChores(config: Tm1Config): Promise<Chore[]> {
  return listChores(config, 'Name,Active,StartTime,DST');
}

async function setChoreActive(name: string, active: boolean, config: Tm1Config): Promise<void> {
  return setChoreActiveApi(config, name, active);
}

async function executeChore(name: string, config: Tm1Config): Promise<void> {
  return executeChoreApi(config, name);
}

export async function manageChoresCommand(): Promise<void> {
  const cfg = await pickDeployTarget();
  if (!cfg) { return; }

  let chores: Chore[];
  try {
    chores = await fetchChores(cfg);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('TM1: Could not load Chores: {0}', errMsg(err)));
    return;
  }

  if (chores.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('TM1: No Chores found on server.'));
    return;
  }

  const items = buildChoreQuickPickItems(chores).map(it => ({
    ...it,
    description: it.active ? vscode.l10n.t('Active') : vscode.l10n.t('Inactive'),
    detail: it.startTime ? vscode.l10n.t('Start time: {0}', it.startTime) : undefined,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Select TM1 Chore'),
    placeHolder: vscode.l10n.t('Choose a Chore…'),
  });
  if (!picked) { return; }

  const chore = picked.chore;

  const actions = buildChoreActionItems(chore).map(it => {
    let label: string;
    let description: string;
    if (it.action === 'execute') {
      label = it.icon + ' ' + vscode.l10n.t('Run now');
      description = vscode.l10n.t('Start chore immediately');
    } else if (it.action === 'deactivate') {
      label = it.icon + ' ' + vscode.l10n.t('Deactivate');
      description = vscode.l10n.t('Disable scheduling');
    } else {
      label = it.icon + ' ' + vscode.l10n.t('Activate');
      description = vscode.l10n.t('Enable scheduling');
    }
    return { ...it, label, description };
  });

  const action = await vscode.window.showQuickPick(actions, {
    title: `Chore: ${chore.Name}`,
    placeHolder: vscode.l10n.t('Choose an action…'),
  });
  if (!action) { return; }

  try {
    if (action.action === 'execute') {
      const { cancelled } = await runCancellableExecution(
        vscode.l10n.t('TM1: Running Chore "{0}"…', chore.Name), 'Chores', chore.Name, cfg,
        () => executeChore(chore.Name, cfg),
      );
      if (cancelled) {
        out.appendLine(`[chore] "${chore.Name}" cancelled`);
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: Chore "{0}" was cancelled.', chore.Name));
      } else {
        out.appendLine(`[chore] "${chore.Name}" executed`);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" started.', chore.Name));
      }
    } else if (action.action === 'activate') {
      await setChoreActive(chore.Name, true, cfg);
      out.appendLine(`[chore] "${chore.Name}" aktiviert`);
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" is now active.', chore.Name));
    } else if (action.action === 'deactivate') {
      await setChoreActive(chore.Name, false, cfg);
      out.appendLine(`[chore] "${chore.Name}" deaktiviert`);
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" is now inactive.', chore.Name));
    }
  } catch (err) {
    out.appendLine(`[chore] FEHLER: ${errMsg(err)}`);
    vscode.window.showErrorMessage(vscode.l10n.t('TM1 Chore error: {0}', errMsg(err)));
  }
}
