import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { buildTransientProcessBody } from '../../tm1Rest/transientProcess';
import { runInlinePreview } from '../processEditor/previewExec';
import { fetchCubeRules } from '../../tm1Rest/cubeApi';
import { errMsg } from '../../utils/errMsg';
import { encodeODataKey } from '../../utils/odataKey';
import { logBestEffort } from '../../providers/bestEffortLog';
import { FeederAuditPanel, type AuditResult, type AuditHit } from '../../webviews/feederAuditWebview';
import { RuleEditorManager } from '../rule/ruleEditor';
import { loadModelKnowledge } from './feederModellwissen';
import { getServerNameByUrl } from '../../serverState/state';
import {
  buildClearCacheProlog, buildOverfeedingProlog, fileNameForRun, OVERFED_RANGE_END,
  parseOverfedCells,
} from '../../debugUtility/overfedScanPure';
import {
  parseFeederStatements, matchesFor, type FeederStatement, type MatchReason,
} from '../../debugUtility/feederTargetMatch';

/** Name of the runs in the TM1 message log (nothing is persisted). */
const RUN_NAME = '}tm1ide_feederaudit';

let _seq = 0;

/** Rule text and element trees per window — only fetched once someone expands a row. */
interface ModelState {
  statements: FeederStatement[];
  model: Awaited<ReturnType<typeof loadModelKnowledge>>;
}
const _stateByKey = new Map<string, Promise<ModelState>>();

/**
 * Overfed cells across the whole cube, together with the feeder statements
 * that may have produced them.
 *
 * No slicing needed: mode 105 walks the FEEDER LIST, not the cell space. On
 * the cubes measured, that was 1-63 ms, even at 1.6e23 cells — but the number
 * is deceptive: the most expensive of these cubes had around 750 feeders. The
 * cost grows with the LENGTH OF THE FEEDER LIST, and a production model with
 * millions of feeders is no longer in the millisecond range. The prompt must
 * therefore not promise a time.
 *
 * Clearing the cache beforehand has been a checkbox since 2026-09-01 and is
 * OFF by default — the old requirement was based on runs with the broken
 * 1..1 range and was measuring the cap bug instead of the cache. See
 * `buildClearCacheProlog`.
 */
export async function runOverfeedingScan(
  cube: string, dimensions: string[], config: Tm1Config, serverId?: string,
  from: number = 1, to: number = OVERFED_RANGE_END, clearCache: boolean = false,
  noticeConfirmed: boolean = false,
): Promise<void> {
  if (!noticeConfirmed) {
    const continueLabel = vscode.l10n.t('Continue');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'The overfeeding scan uses DebugUtility, an undocumented TM1 function. IBM may change or remove it without notice, and it may behave differently on your server version.'),
      { modal: true },
      continueLabel,
    );
    if (choice !== continueLabel) { return; }
  }

  // Measured on v12: `DebugUtility` DOES RUN there (mode 125 reports
  // CompletedSuccessfully, a made-up name aborts) — but the output file shows
  // up neither under `Contents('Files')` nor under `ErrorLogFiles`. A run
  // would succeed and the result would be unreachable.
  if (config.version === 'v12') {
    vscode.window.showWarningMessage(vscode.l10n.t(
      'Feeder audit is not available on TM1 v12 — the server runs the scan, but the result file cannot be read back over REST.'));
    return;
  }

  const key = FeederAuditPanel.open(config.serverUrl, cube, {
    onMatchCell: (i, t) => _matchCell(key, i, t, cube, dimensions, config),
    onOpenRule: (line) => _openRule(cube, line, config),
    onRerun: (v, b, clear) =>
      runOverfeedingScan(cube, dimensions, config, serverId, v, b, clear, true),
  }, getServerNameByUrl(config.serverUrl) ?? serverId);
  // A new run means new rule text: the old state must not stick around, or
  // an expanded row would show feeders from two days ago.
  _stateByKey.delete(key);

  // What the server actually receives — it raises `to` when it is not above
  // `from`, and the window should show the range that actually ran.
  const v = Math.max(1, Math.floor(from));
  const b = Math.max(Math.floor(to), v + 1);
  const base: AuditResult = {
    cube, dimensionen: dimensions, treffer: [], verworfen: 0, gekappt: false, von: v, bis: b,
    cacheLeeren: clearCache,
  };
  try {
    const fileName = fileNameForRun(Date.now(), _seq++);
    const body = JSON.stringify(buildTransientProcessBody({
      name: RUN_NAME,
      // If it is cleared, then in the SAME process: nothing else may re-warm
      // the cache in between. Two separate calls would leave exactly that
      // kind of gap.
      prolog: clearCache
        ? `${buildClearCacheProlog(cube)}\r\n${buildOverfeedingProlog(cube, fileName, v, b)}`
        : buildOverfeedingProlog(cube, fileName, v, b),
    }));
    const run = await runInlinePreview(config, body, {
      logPath: `ErrorLogFiles('${encodeODataKey(fileName)}')`,
      processName: RUN_NAME,
      label: 'feederAudit',
      describeContents: vscode.l10n.t('the feeder audit result'),
    });
    if (run?.text === undefined) {
      FeederAuditPanel.show(key, { ...base, fehler: vscode.l10n.t('The server produced no output file.') });
      return;
    }
    const { cells, discarded, capped } = parseOverfedCells(
      run.text, cube, dimensions, b - v + 1);
    const hits: AuditHit[] = cells.map((z) => ({ cube: z.cube, koordinaten: z.coordinates }));
    FeederAuditPanel.show(key, { ...base, treffer: hits, verworfen: discarded, gekappt: capped });
  } catch (err) {
    FeederAuditPanel.show(key, { ...base, fehler: _errorText(err) });
  }
}

/**
 * Error text for the window.
 *
 * The run sends an unnamed process to `ExecuteProcessWithReturn`, and TM1
 * only lets administrators do that — an account without `ADMIN` gets
 * `ObjectSecurityNoAdminRights` (code 63) back, measured on 2026-09-01 against
 * 11.8. That is not a malfunction but a precondition, and the raw server text
 * tells nobody that.
 */
function _errorText(err: unknown): string {
  const raw = errMsg(err);
  if (/ObjectSecurityNoAdminRights/i.test(raw)) {
    return vscode.l10n.t(
      'The feeder audit requires an administrator account on this TM1 server — the scan runs as an unbound process, which TM1 only allows for administrators. The server said: {0}', raw);
  }
  return raw;
}

/**
 * Determine the candidate FEEDERS lines for ONE cell — only once someone
 * expands the row.
 *
 * Explicitly a SUSPICION: TM1 has no reverse lookup (measured —
 * `tm1.CheckFeeders` and `tm1.TraceFeeders` answer the opposite direction and
 * come back empty on a fed cell, and `DebugUtility(100, ...)` does not output
 * a source field). Multiple statements can hit the same cell, and that is the
 * normal case.
 *
 * Rule text and element trees are fetched ONCE per window and then kept:
 * `loadModelKnowledge` reads the trees of all dimensions, which is not worth
 * doing again per cell.
 */
async function _matchCell(
  key: string, index: number, hit: AuditHit,
  cube: string, dimensions: string[], config: Tm1Config,
): Promise<void> {
  try {
    let state = _stateByKey.get(key);
    if (!state) {
      state = (async () => {
        const ruleText = await fetchCubeRules(config, cube);
        return {
          statements: parseFeederStatements(ruleText),
          model: await loadModelKnowledge(dimensions, config),
        };
      })();
      // A failure must not stick around as a rejected promise: the next row
      // should be allowed to try again.
      _stateByKey.set(key, state);
      state.catch(() => _stateByKey.delete(key));
    }
    const { statements, model } = await state;
    FeederAuditPanel.showCell(key, index,
      matchesFor(statements, dimensions, hit.koordinaten, model)
        .map((z) => ({
          zeile: z.statement.line,
          text: _shorten(z.statement),
          sicher: z.hits === true,
          grund: z.reason ? _localizeReason(z.reason) : undefined,
        })));
  } catch (err) {
    logBestEffort('feederAudit', `feeder match for ${cube}`, err);
    FeederAuditPanel.showCell(key, index, [], errMsg(err));
  }
}

function _localizeReason(reason: MatchReason): string {
  switch (reason.kind) {
    case 'termNichtDeutbar':
      return vscode.l10n.t('Unrecognized term in [{0}]', reason.value);
    case 'elementOhneDimension':
      return vscode.l10n.t('Element "{0}" cannot be assigned to a dimension', reason.value);
    case 'dimensionNichtImCube':
      return vscode.l10n.t('Dimension "{0}" does not belong to this cube', reason.value);
  }
}

/** Statement text for display; long stretches are truncated at the end. */
function _shorten(a: FeederStatement): string {
  const t = a.text.replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** Click on a feeder row: open the rule editor at this location. */
async function _openRule(cube: string, line: number, config: Tm1Config): Promise<void> {
  await RuleEditorManager.open(cube, config, line);
}
