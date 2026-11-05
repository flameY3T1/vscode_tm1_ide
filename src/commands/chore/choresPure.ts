/** Pure helpers for chores QuickPick — no vscode dependencies. */

import type { Tm1Chore } from '../../tm1Rest/choreApi';

export interface ChoreQuickPickItem<C = Tm1Chore> {
  /** Codicon prefix (e.g. `$(check) `) followed by the chore name. */
  label: string;
  /** True when the chore is active — caller localizes the description text. */
  active: boolean;
  /** Raw start time, if any — caller localizes the detail text. */
  startTime: string | null | undefined;
  chore: C;
}

/** Build QuickPick items for the chore selection menu. Pure — no display text. */
export function buildChoreQuickPickItems<C extends { Name: string; Active?: boolean; StartTime?: string | null }>(chores: C[]): ChoreQuickPickItem<C>[] {
  return chores.map(c => ({
    label: (c.Active ? '$(check) ' : '$(circle-outline) ') + c.Name,
    active: !!c.Active,
    startTime: c.StartTime,
    chore: c,
  }));
}

export interface ChoreActionItem {
  /** Codicon prefix for the action (caller localizes the label text). */
  icon: string;
  action: 'execute' | 'activate' | 'deactivate';
}

/** Build action items for the chore-action menu. Pure — no display text. */
export function buildChoreActionItems(chore: { Active?: boolean }): ChoreActionItem[] {
  return [
    { icon: '$(play)', action: 'execute' },
    chore.Active
      ? { icon: '$(debug-stop)', action: 'deactivate' }
      : { icon: '$(check)', action: 'activate' },
  ];
}
