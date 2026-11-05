// src/webviews/processGroupingL10n.ts
// Resolved UI strings for the process-grouping panel. Same pattern as
// tiValueNamingL10n.ts: the extension resolves everything via `vscode.l10n.t`,
// the shell injects the map as `window.__l10n`, and the static body markup is
// rendered server-side from the same map (no untranslated flash).

import * as vscode from 'vscode';
import type { L10nMap } from '../webviewClient/_shared/l10n';

export function buildProcessGroupingL10n(): L10nMap {
  return {
    intro: vscode.l10n.t('Bundles the processes of this server into tree groups. Empty input = no grouping.'),

    modeHead: vscode.l10n.t('Mode'),
    modeSuffix: vscode.l10n.t('Suffix (literal)'),
    modePrefix: vscode.l10n.t('Prefix (literal)'),
    modePatternSuffix: vscode.l10n.t('Pattern at end'),
    modePatternPrefix: vscode.l10n.t('Pattern at start'),

    // One hint PER MODE instead of one per mode pair (feedback from the team,
    // 2026-08-12: the naming alone did not say what the mode does). Each
    // sentence says WHAT is hit and WHAT the group is made from.
    hintSuffix: vscode.l10n.t('A process whose name ENDS with the token becomes the group header. Processes following it alphabetically fall into that group.'),
    hintPrefix: vscode.l10n.t('A process whose name STARTS with the token becomes the group header. Processes following it alphabetically fall into that group.'),
    hintPatternStart: vscode.l10n.t('The pattern is matched at the START of the name; the matched text becomes the group name. No header process — one pattern covers a whole number range.'),
    hintPatternEnd: vscode.l10n.t('The pattern is matched at the END of the name; the matched text becomes the group name. No header process — one pattern covers a whole number range.'),

    exampleHead: vscode.l10n.t('Example'),
    exampleSuffix: vscode.l10n.t(
      'Token: #####\nA_Load_#####      → group header\nA_Load_Accounts   → into A_Load_#####\nA_Load_Customers  → into A_Load_#####\nB_Export_#####    → group header\nB_Export_CSV      → into B_Export_#####'),
    examplePrefix: vscode.l10n.t(
      'Token: ZZ_\nZZ_Load          → group header\nZZ_Load_Accounts → into ZZ_Load\nZZ_Report        → group header\nZZ_Report_Sales  → into ZZ_Report'),
    examplePatternStart: vscode.l10n.t(
      'Pattern: s{n}_\ns001_Load     → group s001_\ns001_Check    → group s001_\ns002_Export   → group s002_\nHelper_Log    → (ungrouped)'),
    examplePatternEnd: vscode.l10n.t(
      'Pattern: _v{n}\nLoad_Accounts_v1  → group _v1\nLoad_Sales_v1     → group _v1\nExport_CSV_v2     → group _v2\nHelper_Log        → (ungrouped)'),

    pitfallHead: vscode.l10n.t('Common mistakes'),
    pitfallLiteral: vscode.l10n.t(
      'Token "_" — nearly every process matches and becomes its own header.\nThe token is matched LITERALLY: "s{n}_" here looks for exactly those characters. Digit ranges need one of the pattern modes.\nGrouping follows the ALPHABETICAL order, not the creation order — a header collects whatever sorts after it, up to the next header.'),
    pitfallPattern: vscode.l10n.t(
      'Pattern "###" — outside braces everything is literal, so this looks for three hash characters. Digits are "{n}".\nPattern "{*}_" — "{*}" matches anything, so almost every process becomes its own group. Put a literal part in front of it.\nPattern "s{n}" without the trailing "_" — "s001_Load" then groups under "s001", and "s0011_Load" lands in the same group.'),

    tokenLabelLiteral: vscode.l10n.t('Token'),
    tokenLabelPattern: vscode.l10n.t('Pattern'),
    tokenPlaceholderLiteral: vscode.l10n.t('e.g. #####'),
    tokenPlaceholderPatternEnd: vscode.l10n.t('e.g. _s{n}'),
    tokenPlaceholderPatternStart: vscode.l10n.t('e.g. s{n}_'),

    syntaxHead: vscode.l10n.t('Pattern syntax — everything outside braces is literal (### stays ###)'),
    synColMeaning: vscode.l10n.t('Meaning'),
    synColExample: vscode.l10n.t('Example'),
    synN: vscode.l10n.t('1 or more digits'),
    synN3: vscode.l10n.t('exactly 3 digits'),
    synA: vscode.l10n.t('1 or more letters/digits'),
    synStar: vscode.l10n.t('anything, up to the next literal part'),
    synBrace: vscode.l10n.t('a literal {'),
    // ONE pattern per placeholder and the process name it hits — the
    // meaning alone left open what that looks like in the name.
    synNEx: vscode.l10n.t('s{n}_ matches s1_Load, s042_Load'),
    synN3Ex: vscode.l10n.t('s{n:3}_ matches s042_Load, but not s1_Load'),
    synAEx: vscode.l10n.t('{a}_Load matches DE_Load, X1_Load'),
    synStarEx: vscode.l10n.t('Load_{*}_ matches Load_Sales_, Load_Any_Thing_'),
    synBraceEx: vscode.l10n.t('{{n}_ matches {n}_Load'),

    errUnclosed: vscode.l10n.t('Missing closing brace }.'),
    errEmpty: vscode.l10n.t('Empty placeholder {}.'),
    errUnknown: vscode.l10n.t('Unknown placeholder "{0}". Allowed: n, n:3, a, a:3, *'),

    previewHead: vscode.l10n.t('Preview'),
    previewNoNames: vscode.l10n.t('No process list available — connect the server to see a preview.'),
    previewNoGroups: vscode.l10n.t('No grouping: all processes stay flat under "Processes".'),
    previewNoMatch: vscode.l10n.t('Nothing matches — every process lands in {0}.'),
    previewSummary: vscode.l10n.t('{0} groups out of {1} processes'),
    ungrouped: vscode.l10n.t('(Ungrouped)'),
    countProcesses: vscode.l10n.t('{0} processes'),
    more: vscode.l10n.t('+{0} more'),

    save: vscode.l10n.t('Save'),
    reset: vscode.l10n.t('Remove grouping'),
  };
}
