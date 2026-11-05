// src/commands/rule/ruleEditorMonacoL10n.ts
// Resolved UI strings for the Monaco-based Rule-Editor webview. The body markup
// (`ruleEditorBody`) and the client (`window.__l10n`) share this single map, so
// each English source string is translated once. Keys are stable JS identifiers;
// the `vscode.l10n.t(...)` argument is the localization key (English source =
// key, per the Phase 2 convention). DE translations live in
// `l10n/bundle.l10n.de.json`.
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildRuleEditorMonacoL10n(): L10nMap {
  return {
    // toolbar (static body) — title label mirrors the process editor's
    // static "Process" (front of the toolbar, before the code-actions).
    titleRules: vscode.l10n.t('Rules'),
    saveTitle: vscode.l10n.t('Save rules (Ctrl+S)'),
    save: vscode.l10n.t('Save'),
    qualifyTitle: vscode.l10n.t('Qualify bare element references like [\'Elem\'] with their dimension'),
    elementQualifier: vscode.l10n.t('Element qualifier'),
    areaDbBuilder: vscode.l10n.t('Area/DB Builder'),
    areaDbBuilderTitle: vscode.l10n.t('Open Area/DB Builder to construct a DB() reference and insert it at the cursor'),
    formatTitle: vscode.l10n.t('Format rules (Ctrl+Shift+I)'),
    format: vscode.l10n.t('Format'),
    formatOptions: vscode.l10n.t('Formatting options'),
    fmtApplyNow: vscode.l10n.t('Apply now'),
    unsavedChanges: vscode.l10n.t('Unsaved changes'),

    // code-actions dropdown (mirrors the process editor)
    editMenuTitle: vscode.l10n.t('Code actions: indent, outdent, comment'),
    editMenuLabel: vscode.l10n.t('Code actions'),
    edIndent: vscode.l10n.t('Indent'),
    edOutdent: vscode.l10n.t('Outdent'),
    edComment: vscode.l10n.t('Comment'),
    edUncomment: vscode.l10n.t('Uncomment'),

    // banners
    rulesSavedSuccessfully: vscode.l10n.t('Rules saved successfully.'),
    loadingRules: vscode.l10n.t('Loading rules…'),

    // tabs
    tabEditor: vscode.l10n.t('Editor'),
    tabLinter: vscode.l10n.t('Linter'),
    tabReferences: vscode.l10n.t('References'),

    // linter panel
    linterFilterPlaceholder: vscode.l10n.t('Filter (message / severity / rule / line)…'),

    // references panel
    refFilterPlaceholder: vscode.l10n.t('Filter (line / context)…'),
    clearHighlightsTitle: vscode.l10n.t('Clear highlights (Esc)'),
    clear: vscode.l10n.t('Clear'),

    // in-editor find/replace overlay (shared _shared/findOverlay)
    xfindAria: vscode.l10n.t('Search and replace'),
    xfindToggleTitle: vscode.l10n.t('Show/hide replace (Ctrl+H)'),
    xfindPlaceholder: vscode.l10n.t('Search…'),
    xfindPrevTitle: vscode.l10n.t('Previous result (Shift+Enter)'),
    xfindNextTitle: vscode.l10n.t('Next result (Enter)'),
    xfindCaseTitle: vscode.l10n.t('Match case (Alt+C)'),
    xfindCloseTitle: vscode.l10n.t('Close (Esc)'),
    xfindReplacePlaceholder: vscode.l10n.t('Replace with…'),
    xfindReplaceOneTitle: vscode.l10n.t('Replace current match (Enter in replace field)'),
    xfindReplaceAllTitle: vscode.l10n.t('Replace all matches (Ctrl+Alt+Enter)'),
    xfindNoMatch: vscode.l10n.t('No match'),
    xfindReplaced: vscode.l10n.t('{0} replaced'),

    // client runtime — index.ts
    resolving: vscode.l10n.t('Resolving…'),
    unknownSaveError: vscode.l10n.t('Unknown error while saving.'),
    // `{0}` filled with the failure message.
    elementQualifierFailed: vscode.l10n.t('Element qualifier failed: {0}'),
    unknown: vscode.l10n.t('unknown'),
    qualifierDoneSave: vscode.l10n.t('Element qualifier finished — press Save to apply the changes.'),
    qualifierNothing: vscode.l10n.t('Element qualifier: nothing to qualify.'),
    // `{0}` = warning count.
    qualifierWarningsHeader: vscode.l10n.t('Element qualifier: {0} warning(s):'),
    // `{0}` = line, `{1}` = entry, `{2}` = reason, `{3}` = optional detail suffix.
    qualifierWarningLine: vscode.l10n.t('Line {0}: {1} — {2}{3}'),
    // `{0}` = count of further warnings.
    qualifierMore: vscode.l10n.t('…and {0} more.'),

    // client runtime — linter.ts
    noProblemsFound: vscode.l10n.t('No problems found.'),
    noFilterMatch: vscode.l10n.t('No match for filter.'),
    // `{0}` = count
    problemsCount: vscode.l10n.t('{0} problems'),
    // `{0}` = filtered, `{1}` = total
    problemsFilteredCount: vscode.l10n.t('{0} / {1} problems'),
    colLine: vscode.l10n.t('Line'),
    colSev: vscode.l10n.t('Sev'),
    colRule: vscode.l10n.t('Rule'),
    colMessage: vscode.l10n.t('Message'),
    jumpToLine: vscode.l10n.t('Jump to line'),

    // client runtime — references.ts
    doubleClickWord: vscode.l10n.t('Double-click a word in the editor to show occurrences.'),
    noOccurrencesFound: vscode.l10n.t('No occurrences found.'),
    // `{0}` = count
    occurrencesCount: vscode.l10n.t('{0} occurrences'),
    // `{0}` = filtered, `{1}` = total
    occurrencesFilteredCount: vscode.l10n.t('{0} / {1} occurrences'),
    colContext: vscode.l10n.t('Context'),
    // `{0}` = the word (HTML-wrapped in <strong> client-side)
    wordLabel: vscode.l10n.t('Word: {0}'),

    // client runtime — formatMenu.ts
    fmtCasing: vscode.l10n.t('Keyword / function casing'),
    fmtOperators: vscode.l10n.t('Operator spacing'),
    fmtCommaSpace: vscode.l10n.t('Space after comma'),
    fmtSemicolon: vscode.l10n.t('No space before ;'),
    fmtCollapseSpaces: vscode.l10n.t('No multiple spaces'),
    fmtTrailing: vscode.l10n.t('No trailing whitespace'),
    fmtCommentHash: vscode.l10n.t('Space after comment #'),
    fmtBlankLines: vscode.l10n.t('Max. 2 blank lines'),
    fmtSplitStatements: vscode.l10n.t('One statement per line'),
    fmtParens: vscode.l10n.t('Parentheses:'),

    // client runtime — completions.ts
    detailRuleConstNoCalc: vscode.l10n.t('Rule constant (no calculation)'),
    detailRuleConstNextRule: vscode.l10n.t('Rule constant (next rule)'),
    dbDoc: vscode.l10n.t('Read a value from a cube. After the cube name follow as many element arguments as the cube has dimensions.'),
    detailCellRef: vscode.l10n.t('Cell reference'),
    detailDimension: vscode.l10n.t('Dimension'),
    detailCube: vscode.l10n.t('Cube'),
    // `{0}` = dimension name
    detailAttributeOf: vscode.l10n.t('Attribute of {0}'),
    // `{0}` = dimension count, `{1}` = "Dimension"/"Dimensions" (pluralized client-side)
    detailCubeDims: vscode.l10n.t('Cube ({0} {1})'),
    dimensionSingular: vscode.l10n.t('Dimension'),
    dimensionPlural: vscode.l10n.t('Dimensions'),
    detailCubeDimIterator: vscode.l10n.t('Cube dimension (element iterator)'),

    // signature hover doc (tiSignatureRender.buildMarkdownDoc)
    sigParameters: vscode.l10n.t('**Parameters:**'),
    // `{0}` = return type
    sigReturns: vscode.l10n.t('**Returns:** *{0}*'),
    // `{0}` = minimum argument count
    sigVariadic: vscode.l10n.t('*Variadic: at least {0} arguments.*'),
    sigDeprecatedV12: vscode.l10n.t('⚠️ **Not available in TM1 v12 (Planning Analytics Cloud Native).**'),
    // `{0}` = recommended section, `{1}` = reason
    sigPerformance: vscode.l10n.t('💡 **Performance:** Ideal in the `{0}` section ({1}).'),

    // Rules-linter rule config panel (rulesLintRuleLabels.ts)
    rlParseErrorName: vscode.l10n.t('Parse error'),
    rlParseErrorDesc: vscode.l10n.t('A line the rules parser cannot read at all.'),
    rlMissingSemiName: vscode.l10n.t('Missing semicolon'),
    rlMissingSemiDesc: vscode.l10n.t('A rule or feeder statement that does not end in a semicolon.'),
    rlUnclosedBracketName: vscode.l10n.t('Unclosed bracket'),
    rlUnclosedBracketDesc: vscode.l10n.t('A cell reference whose square brackets are not balanced.'),
    rlInvalidRefName: vscode.l10n.t('Malformed cell reference'),
    rlInvalidRefDesc: vscode.l10n.t('A cell reference that matches none of the valid forms.'),
    rlUnqualifiedRefName: vscode.l10n.t('Element without dimension'),
    rlUnqualifiedRefDesc: vscode.l10n.t("Style rule: flags ['Element'] written without its dimension. Valid TM1, but ambiguous when the element name occurs in more than one dimension. Off by default."),
    rlNoFeedersName: vscode.l10n.t('No FEEDERS section'),
    rlNoFeedersDesc: vscode.l10n.t('Rules with SKIPCHECK but no FEEDERS block.'),
    rlMultiFeedersName: vscode.l10n.t('Multiple FEEDERS markers'),
    rlMultiFeedersDesc: vscode.l10n.t('More than one FEEDERS; line in the same rule set.'),
    rlRuleAfterFeedName: vscode.l10n.t('Rule after FEEDERS'),
    rlRuleAfterFeedDesc: vscode.l10n.t('A rule line (C:/N:/S:) below the FEEDERS block, where it no longer applies.'),
    rlFeedArrowName: vscode.l10n.t('Feeder without arrow'),
    rlFeedArrowDesc: vscode.l10n.t('A feeder line that is missing its => arrow.'),
    rlFeedCommaName: vscode.l10n.t('Feeder missing comma'),
    rlFeedCommaDesc: vscode.l10n.t('Two cell references in a feeder that are not separated by a comma.'),
    rlFeedMultiLhsName: vscode.l10n.t('Multiple sources in a feeder'),
    rlFeedMultiLhsDesc: vscode.l10n.t('More than one cell reference left of the arrow.'),
    rlFeedDbLhsName: vscode.l10n.t('DB() left of the arrow'),
    rlFeedDbLhsDesc: vscode.l10n.t('A DB() call as the source of a feeder, where only a cell reference belongs.'),
    rlDbFewArgsName: vscode.l10n.t('DB() with too few arguments'),
    rlDbFewArgsDesc: vscode.l10n.t('DB() needs at least a cube name plus one dimension.'),
    rlDbArgCountName: vscode.l10n.t('DB() argument count'),
    rlDbArgCountDesc: vscode.l10n.t('The number of DB() arguments does not match the dimension count of the cube.'),
    rlDbInvalidCubeName: vscode.l10n.t('DB() cube argument'),
    rlDbInvalidCubeDesc: vscode.l10n.t('The first DB() argument is not a usable cube name.'),
    rlDbCondCubeName: vscode.l10n.t('DB() cube from a condition'),
    rlDbCondCubeDesc: vscode.l10n.t('The cube name comes out of an expression, so it cannot be checked statically.'),
    rlDbUnknownCubeName: vscode.l10n.t('DB() names an unknown cube'),
    rlDbUnknownCubeDesc: vscode.l10n.t('Checked against the connected server.'),
    rlDbElemName: vscode.l10n.t('DB() names an unknown element'),
    rlDbElemDesc: vscode.l10n.t('Checked against the connected server.'),
    rlDimNotFoundName: vscode.l10n.t('Unknown dimension'),
    rlDimNotFoundDesc: vscode.l10n.t('A dimension in a cell reference that the server does not have.'),
    rlHierNotFoundName: vscode.l10n.t('Unknown hierarchy'),
    rlHierNotFoundDesc: vscode.l10n.t('A hierarchy in a cell reference that the server does not have.'),
    rlElemNotFoundName: vscode.l10n.t('Unknown element'),
    rlElemNotFoundDesc: vscode.l10n.t('An element in a cell reference that the server does not have.'),
    rlSevError: vscode.l10n.t('Error'),
    rlSevWarning: vscode.l10n.t('Warning'),
    rlSevInfo: vscode.l10n.t('Info'),
    rlSevHint: vscode.l10n.t('Hint'),
    rlGroupSyntax: vscode.l10n.t('Syntax'),
    rlGroupFeeders: vscode.l10n.t('Feeders'),
    rlGroupDb: vscode.l10n.t('DB() calls'),
    rlGroupServer: vscode.l10n.t('Checked against the server'),
    rlGroupOther: vscode.l10n.t('Other'),
    rlSubtabResults: vscode.l10n.t('Results'),
    rlFilterAll: vscode.l10n.t('All'),
    rlFilterErrors: vscode.l10n.t('Errors'),
    rlFilterWarnings: vscode.l10n.t('Warnings'),
    rlFilterInfos: vscode.l10n.t('Infos'),
    rlFilterHints: vscode.l10n.t('Hints'),
    rlSubtabRules: vscode.l10n.t('Rules'),
  };
}
