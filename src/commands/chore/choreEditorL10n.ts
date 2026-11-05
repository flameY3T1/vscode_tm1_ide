// src/commands/chore/choreEditorL10n.ts
// Resolved UI strings for the Chore Editor webview. The body markup
// (`buildChoreEditorBody`) and the client (`window.__l10n`) share this single
// map, so each English source string is translated once. Property names are
// stable JS identifiers; the `vscode.l10n.t(...)` argument is the localization
// key (English source = key, per the Phase 2 convention). DE translations live
// in `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildChoreEditorL10n(): L10nMap {
  return {
    // ── static body ──────────────────────────────────────────────────────
    loading: vscode.l10n.t('Loading chore data…'),
    toolbarTitle: vscode.l10n.t('Chore Editor'),
    save: vscode.l10n.t('Save'),
    saveAs: vscode.l10n.t('Save as…'),
    saveAsTitle: vscode.l10n.t('Save the chore under a new name'),
    runTitle: vscode.l10n.t('Save first, then run the chore'),
    saveAndRun: vscode.l10n.t('Save & Run'),
    cancel: vscode.l10n.t('Cancel'),
    properties: vscode.l10n.t('Properties'),
    name: vscode.l10n.t('Name'),
    namePlaceholder: vscode.l10n.t('Chore name…'),
    active: vscode.l10n.t('Active (scheduling enabled)'),
    dst: vscode.l10n.t('DST (account for daylight saving time)'),
    executionMode: vscode.l10n.t('Execution mode'),
    singleCommit: vscode.l10n.t('Single commit (whole chore = one transaction)'),
    multipleCommit: vscode.l10n.t('Multiple commit (each task commits separately)'),
    // Shown ONLY when the server did not report the chore's ExecutionMode (the
    // chore-detail fallback ladder had to drop it from $select). The field is
    // then left out of the save payload until a mode is picked on purpose.
    execModeUnknown: vscode.l10n.t('Unknown — not reported by this server (stays unchanged when saving)'),
    startTime: vscode.l10n.t('Start time'),
    dateTitle: vscode.l10n.t('Start date (anchor) — first run / weekday reference'),
    hourTitle: vscode.l10n.t('Hour (0–23)'),
    minuteTitle: vscode.l10n.t('Minute (0–59)'),
    timeZoneHint: vscode.l10n.t('time (UTC)'),
    frequency: vscode.l10n.t('Frequency'),
    freq15min: vscode.l10n.t('Every 15 minutes'),
    freq30min: vscode.l10n.t('Every 30 minutes'),
    freqHourly: vscode.l10n.t('Hourly'),
    freq2h: vscode.l10n.t('Every 2 hours'),
    freq4h: vscode.l10n.t('Every 4 hours'),
    freq6h: vscode.l10n.t('Every 6 hours'),
    freq12h: vscode.l10n.t('Every 12 hours'),
    freqDaily: vscode.l10n.t('Daily'),
    freqWeekly: vscode.l10n.t('Weekly'),
    freqNDays: vscode.l10n.t('Number of days…'),
    nDaysTitle: vscode.l10n.t('Number of days'),
    days: vscode.l10n.t('days'),
    tasks: vscode.l10n.t('Tasks'),
    addTask: vscode.l10n.t('+ Add task'),
    // ── client runtime ───────────────────────────────────────────────────
    chooseProcess: vscode.l10n.t('— Choose process —'),
    moveUp: vscode.l10n.t('Move up'),
    moveDown: vscode.l10n.t('Move down'),
    removeTask: vscode.l10n.t('Remove task'),
    // `{0}` filled client-side with the 1-based task number.
    taskN: vscode.l10n.t('Task {0}'),
    noProcessChosen: vscode.l10n.t('No process chosen.'),
    loadingParams: vscode.l10n.t('Loading parameters…'),
    noParams: vscode.l10n.t('This process has no parameters.'),
    colParameter: vscode.l10n.t('Parameter'),
    colType: vscode.l10n.t('Type'),
    colValue: vscode.l10n.t('Value'),
    nameRequired: vscode.l10n.t('Name must not be empty.'),
    // `{0}` filled client-side with the 1-based task number.
    taskNoProcess: vscode.l10n.t('Task {0} has no process chosen.'),
    // `{0}` filled client-side with the error message.
    errorPrefix: vscode.l10n.t('Error: {0}'),
    // `{0}` filled client-side with the process names still being loaded.
    paramsStillLoading: vscode.l10n.t('Parameters of {0} are still loading — please try again in a moment.'),
    // `{0}` filled client-side with the process names whose definitions failed.
    paramsLoadFailed: vscode.l10n.t('Parameters of {0} could not be loaded — saving now would send the wrong parameters.'),
    paramsLoadError: vscode.l10n.t('Parameters could not be loaded.'),
    paramNotNumeric: vscode.l10n.t('Task {0}, parameter "{1}" expects a number, but holds "{2}".'),
    saveCancelled: vscode.l10n.t('Save cancelled — nothing was changed on the server.'),
    // `{0}` filled client-side with the chore name.
    choreTitle: vscode.l10n.t('Chore: {0}'),
    nameReadonly: vscode.l10n.t('Name cannot be changed after creation.'),
    newChore: vscode.l10n.t('New chore'),
    // filterCombo.ts reads these three.
    selectPlaceholder: vscode.l10n.t('Select…'),
    filterElements: vscode.l10n.t('Filter by name…'),
    noMatches: vscode.l10n.t('No matches'),
  };
}
