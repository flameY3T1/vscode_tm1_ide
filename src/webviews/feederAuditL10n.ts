import * as vscode from 'vscode';
import type { FeederAuditL10n } from './feederAuditBodyPure';

/**
 * Labels of the overfeeding window.
 *
 * Deliberately detailed: overfeeding goes unnoticed because the numbers
 * are right — whoever opens the window should understand without looking anything up what they
 * are seeing, what it costs and where the limits of the statement lie.
 */
export function buildFeederAuditL10n(): FeederAuditL10n {
  return {
    heading: vscode.l10n.t('Overfed cells'),
    what: vscode.l10n.t(
      'An overfed cell is fed by a feeder but holds no value. The numbers in your model are correct — the cell simply exists for nothing.'),
    cost: vscode.l10n.t(
      'Each one occupies memory and slows down every aggregation that passes through it. Nobody complains, because the numbers look right — which is why overfeeding accumulates unnoticed.'),
    cacheLabel: vscode.l10n.t('Clear cube cache first'),
    cacheHint: vscode.l10n.t(
      'Some cubes report nothing until their cache is cleared. Clearing affects every session on this server.'),
    caveatCost: vscode.l10n.t(
      'The scan walks the complete feeder list of the cube and holds a read lock while it runs. The time it takes grows with the number of feeders, not with the size of the cube.'),
    caveatUndocumented: vscode.l10n.t(
      'The scan uses DebugUtility, a TI function IBM does not document. Everything this window relies on — that mode 105 lists overfed cells, that its second and third argument are a cell range, that mode 125 clears the cube cache — was established by measurement on TM1 11.8, not from documentation. IBM can change or drop it without notice, and it may behave differently on another version.'),
    scope: vscode.l10n.t('Cube "{0}" · whole cube'),
    hits: vscode.l10n.t('{0} cell(s) found. Click a row to check its feeders.'),
    noHits: vscode.l10n.t('Nothing found.'),
    noHitsHint: vscode.l10n.t(
      'No overfed cells in this cube. On some cubes nothing is reported until the cube cache has been cleared — try again with that option turned on.'),
    capped: vscode.l10n.t(
      'The range is full — the list ends at cell {0} because that is where you asked it to stop, not because the cube ran out. Use "Next range" to continue at cell {1}.'),
    dropped: vscode.l10n.t(
      '{0} line(s) were dropped because their number of fields did not match the cube. An element name containing a comma cannot be resolved in this output format.'),
    rangeFrom: vscode.l10n.t('Cells from'),
    rangeTo: vscode.l10n.t('to'),
    rangeBad: vscode.l10n.t(
      'The last cell must be greater than the first one — the server returns an empty file for any other range and still reports success.'),
    next: vscode.l10n.t('Next range'),
    colNr: vscode.l10n.t('#'),
    openCell: vscode.l10n.t('Show the feeder statements that can produce this cell'),
    feederHeading: vscode.l10n.t('Feeder statements that can produce this cell:'),
    feederNone: vscode.l10n.t('No feeder statement in the rule matches this cell.'),
    feederUnsure: vscode.l10n.t('undecidable: {0}'),
    feederSearching: vscode.l10n.t('Matching against the rule text…'),
    feederFailed: vscode.l10n.t('Feeder statements could not be matched: {0}'),
    openRule: vscode.l10n.t('Open in rule editor'),
    line: vscode.l10n.t('Line {0}'),
    running: vscode.l10n.t('Scanning…'),
    failed: vscode.l10n.t('The scan failed: {0}'),
    rerun: vscode.l10n.t('Scan again'),
    details: vscode.l10n.t('What you should know about this scan'),
  };
}
