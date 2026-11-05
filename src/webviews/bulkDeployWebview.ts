// src/webviews/bulkDeployWebview.ts
// Bulk migration: choose object kinds, filter by name pattern, check against the
// TARGET SERVER, and overwrite in ONE run.
//
// Why a page of its own next to the commands in the tree: the single commands
// (`tm1.deployProcessToServer`, `tm1.deployViewsToServer`,
// `tm1.deploySubsetsToServer`) presuppose that one finds the pieces in the tree
// and clicks them together. A pattern like `zzTest_*` hits views in
// a hundred cubes and subsets in eighty dimensions — nobody clicks those
// together. And the tree does not answer the question that precedes every migration:
// what does the piece need over there, and is it there?
//
// What the page does NOT do: create cubes and dimensions (that is a process
// of its own, not a by-product), rename (source name = target name), and touch private
// views/subsets.

import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { WebviewPanelHost } from './webviewPanelHost';
import { renderWebviewShell } from './webviewShell';
import { escapeHtml } from '../utils/escapeHtml';
import { errMsg } from '../utils/errMsg';
import { buildBulkDeployL10n } from './bulkDeployL10n';
import { BULK_TABLE_CSS } from './bulkTableCss';
import { rowLabel, rowKey } from './bulkObjectsPure';
import { hardBlockers, openMissing, sortForDeploy, type DeployKind } from './bulkDeployPure';
import { handleBulkSearch } from './bulkSearch';
import type { L10nMap } from '../webviewClient/_shared/l10n';
import type {
  CheckResult, DeployOutcome, DeployRef, HostToWebview, TargetOption, WebviewToHost,
} from '../webviewClient/bulkDeploy/protocol';
import {
  checkDeployItems, readTargetInventory,
} from '../commands/deploy/deployCheck';
import { deployOne } from '../commands/deploy/deployWrite';
import { forgetDocs, openCompareDiff, readCompareDoc, rememberDocs } from '../commands/deploy/compareRead';
import { CHORE_ACTIVE_PART, CHORE_MODE_PART, compareParts, onlyIfBoth, type CompareResult } from './bulkComparePure';
import { mapLimit } from '../utils/mapLimit';
import type { FlattenChoice } from '../commands/dimension/dimensionSubsetSave';
import type { KnownTarget } from '../commands/deploy/copyOne';
import { getConnectedIds, getServerConfig, getServerNameByUrl } from '../serverState/state';
import { getOrBuildIndex, invalidateReferenceIndex } from '../references/referenceIndexService';
import { invalidateCache } from '../providers/fetchNames';
import { postTo } from './typedPost';

/**
 * Which inventory list carries a missing-finding — `inv.failed` carries the
 * LISTS, the findings name the OBJECT KIND. Only where both fit together is
 * "missing over there" read and not guessed.
 */
const MISSING_LIST: Record<string, string> = { hierarchy: 'hierarchies' };

/** Only what the target table additionally needs — the rest comes from the bulk delete. */
const EXTRA_CSS = [
  '.bd-target { min-width: 220px; }',
  '.bd-arrow { color: var(--vscode-descriptionForeground); }',
].join('\n');

const CSS = `${BULK_TABLE_CSS}\n${EXTRA_CSS}`;

function body(l10n: L10nMap, sourceLabel: string): string {
  const kindCheck = (k: DeployKind, labelKey: string): string =>
    `<label class="bd-check"><input type="checkbox" class="bd-kind-box" data-kind="${k}">`
    + `<span>${escapeHtml(l10n[labelKey] ?? k)}</span></label>`;
  return [
    '<div class="bd-head">',
    `  <span class="bd-title">${escapeHtml(l10n.title ?? 'Bulk Deploy')}</span>`,
    `  <span class="bd-server">${escapeHtml(sourceLabel)}</span>`,
    '  <span class="bd-arrow">→</span>',
    `  <span class="bd-label">${escapeHtml(l10n.target ?? '')}</span>`,
    '  <select id="bd-target" class="bd-target"></select>',
    // The target list is fixed on open; but connecting often happens only
    // afterwards. Without this button one would have to close the page and reopen it
    // just to see a freshly connected server.
    `  <button class="bd-iconbtn" id="bd-target-refresh" title="${escapeHtml(l10n.refreshTargets ?? '')}">⟳</button>`,
    '  <span class="bd-spacer"></span>',
    '</div>',
    `<div class="bd-hint">${escapeHtml(l10n.hint ?? '')}</div>`,
    '<div class="bd-controls">',
    `  <div class="bd-row bd-step"><span class="bd-step-num">1</span>${escapeHtml(l10n.step1 ?? '')}</div>`,
    '  <div class="bd-row">',
    `    <span class="bd-label">${escapeHtml(l10n.types ?? '')}</span>`,
    '    <span class="bd-kinds">',
    kindCheck('process', 'kindProcesses'),
    kindCheck('rule', 'kindRules'),
    kindCheck('chore', 'kindChores'),
    kindCheck('view', 'kindViews'),
    kindCheck('subset', 'kindSubsets'),
    '    </span>',
    '  </div>',
    '  <div class="bd-row">',
    `    <span class="bd-label">${escapeHtml(l10n.pattern ?? '')}</span>`,
    `    <input type="text" id="bd-pattern" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(l10n.patternPlaceholder ?? '')}">`,
    `    <label class="bd-check"><input type="checkbox" id="bd-control"><span>${escapeHtml(l10n.showControl ?? '')}</span></label>`,
    '  </div>',
    `  <div class="bd-row"><span class="bd-label"></span><span class="bd-help">${escapeHtml(l10n.patternHelp ?? '')}</span></div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button id="bd-search" disabled>${escapeHtml(l10n.searchBtn ?? '')}</button>`,
    `    <span class="bd-help" id="bd-search-hint">${escapeHtml(l10n.pickTypes ?? '')}</span>`,
    '  </div>',
    '  <div class="bd-sep"></div>',
    // Step 2: select AND check. Both belong together since the
    // check takes exactly the ticked rows: reading a view costs
    // two fetches, and whoever wants to transfer three processes should not have 200
    // views checked.
    `  <div class="bd-row bd-step"><span class="bd-step-num">2</span>${escapeHtml(l10n.step2 ?? '')}</div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button class="secondary" id="bd-all">${escapeHtml(l10n.selectAll ?? '')}</button>`,
    `    <button class="secondary" id="bd-none">${escapeHtml(l10n.selectNone ?? '')}</button>`,
    `    <button class="secondary" id="bd-check" disabled>${escapeHtml(l10n.checkBtn ?? '')}</button>`,
    `    <label class="bd-check"><input type="checkbox" id="bd-diff-only"><span>${escapeHtml(l10n.diffOnly ?? '')}</span></label>`,
    '  </div>',
    '  <div class="bd-sep"></div>',
    // Step 3: the action that changes something over there — visibly separated from the
    // two before it.
    `  <div class="bd-row bd-step"><span class="bd-step-num">3</span>${escapeHtml(l10n.step3 ?? '')}</div>`,
    '  <div class="bd-row">',
    '    <span class="bd-label"></span>',
    `    <button class="danger" id="bd-deploy" disabled>${escapeHtml(l10n.deployBtn ?? '')}</button>`,
    '    <span class="bd-count" id="bd-count"></span>',
    '  </div>',
    '</div>',
    '<div class="bd-busy" id="bd-busy" hidden></div>',
    '<div class="bd-note" id="bd-note" hidden></div>',
    '<div class="bd-error" id="bd-error" hidden></div>',
    '<div class="bd-wrap">',
    '  <table class="bd-table">',
    '    <thead><tr>',
    '      <th style="width:26px"><input type="checkbox" id="bd-head-box"></th>',
    '      <th style="width:20px"></th>',
    `      <th style="width:90px">${escapeHtml(l10n.colType ?? '')}</th>`,
    `      <th>${escapeHtml(l10n.colName ?? '')}</th>`,
    `      <th style="width:110px">${escapeHtml(l10n.colTarget ?? '')}</th>`,
    `      <th style="width:120px">${escapeHtml(l10n.colMissing ?? '')}</th>`,
    `      <th style="width:180px">${escapeHtml(l10n.colContent ?? '')}</th>`,
    '    </tr></thead>',
    '    <tbody id="bd-tbody"></tbody>',
    '  </table>',
    '  <div class="bd-empty" id="bd-empty" hidden></div>',
    '</div>',
  ].join('\n');
}

/** Where a row's two documents are kept — per source, target and object. */
function compareKey(serverId: string, targetId: string, ref: DeployRef): string {
  return `${serverId}>${targetId}|${rowKey(ref)}`;
}

/** Read the object on both servers and compare it part by part. */
async function compareContent(
  srcCfg: Tm1Config, tgtCfg: Tm1Config, ref: DeployRef, key: string,
): Promise<CompareResult> {
  try {
    let [source, target] = await Promise.all([
      readCompareDoc(srcCfg, ref), readCompareDoc(tgtCfg, ref),
    ]);
    if (ref.kind === 'chore') { [source, target] = onlyIfBoth(source, target, CHORE_MODE_PART); }
    rememberDocs(key, rowLabel(ref), source, target);
    return compareParts(source, target,
      ref.kind === 'chore' ? new Set([CHORE_ACTIVE_PART]) : undefined);
  } catch (err) {
    return { status: 'error', parts: [], expected: [], reason: errMsg(err) };
  }
}

function serverLabel(serverUrl?: string, fallback = ''): string {
  if (!serverUrl) { return fallback; }
  const name = getServerNameByUrl(serverUrl);
  if (name) { return name; }
  try {
    const u = new URL(serverUrl);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return serverUrl;
  }
}

/**
 * The connected servers except the source — only those can be the target.
 *
 * Excluding the PROFILE id is not enough: two profiles may point to the
 * same instance (exactly that is what the key comment in `open` reckons with),
 * and then the source appeared under its second name in the
 * target list. A run onto itself is harmless for process, rule and view
 * — for a chore `saveChore` (deactivate, empty tasks,
 * rewrite, activate) runs against the original, and for static
 * subsets `saveSubset` asks per piece after flattening. The user
 * believes to have migrated in the process.
 */
export function targetOptions(sourceServerId: string, sourceUrl?: string): TargetOption[] {
  const out: TargetOption[] = [];
  for (const id of getConnectedIds()) {
    if (id === sourceServerId) { continue; }
    const cfg = getServerConfig(id);
    if (!cfg) { continue; }
    if (sameServer(cfg.serverUrl, sourceUrl)) { continue; }
    out.push({ id, label: serverLabel(cfg.serverUrl, id), url: cfg.serverUrl ?? '' });
  }
  return out;
}

/**
 * Do two accesses point to the same instance?
 *
 * The normalized URL is compared, not the string: a trailing
 * slash and the upper/lower case of the host name
 * do not make a different server.
 */
export function sameServer(a?: string, b?: string): boolean {
  if (!a || !b) { return false; }
  const norm = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** Which autocomplete name lists a kind invalidates on the TARGET. */
const INVALIDATES: Partial<Record<DeployKind, string[]>> = {
  process: ['Processes'],
  chore: ['Chores'],
};

export class BulkDeployPanel {
  private static host: WebviewPanelHost<WebviewToHost> | undefined;
  private static refreshTree: () => void = () => { /* set by initialize */ };
  private static readonly cfgByKey = new Map<string, Tm1Config>();

  static initialize(extensionUri: vscode.Uri, refreshTree: () => void): void {
    this.refreshTree = refreshTree;
    this.host = new WebviewPanelHost<WebviewToHost>('tm1.bulkDeploy', 'Bulk Deploy');
    this.host.initialize(extensionUri);
  }

  static disposeAll(): void { this.host?.disposeAll(); }

  /** Close this server's page (on disconnect). */
  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  static open(cfg: Tm1Config, serverId: string, displayName?: string): void {
    if (!this.host) { throw new Error('BulkDeployPanel not initialized'); }
    // Server URL FIRST — exactly the form that `disposePanelsForServer` finds on
    // disconnect; the profile behind it, so that two profiles on the same
    // instance do not share the same page (and thus the same `Tm1Config`).
    const key = `${cfg.serverUrl}::deploy#${serverId}`;
    this.cfgByKey.set(key, cfg);
    const label = displayName ?? cfg.serverUrl ?? '';

    this.host.open({
      key,
      title: vscode.l10n.t('Bulk Deploy: {0}', label),
      html: (webview, extensionUri) => {
        const l10n = buildBulkDeployL10n();
        l10n.title = vscode.l10n.t('Bulk Deploy');
        return renderWebviewShell({
          cspSource: webview.cspSource,
          title: 'TM1 Bulk Deploy',
          css: CSS,
          body: body(l10n, label),
          globals: { __l10n: l10n },
          scriptUris: [String(webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'bulkDeploy.js')))],
        });
      },
      onMessage: (msg, panel) =>
        BulkDeployPanel.onMessage(msg, panel, BulkDeployPanel.cfgByKey.get(key) ?? cfg, serverId),
      onDispose: () => { BulkDeployPanel.cfgByKey.delete(key); },
    });
  }

  private static async onMessage(
    msg: WebviewToHost,
    panel: vscode.WebviewPanel,
    cfg: Tm1Config,
    serverId: string,
  ): Promise<void> {
    const post = (out: HostToWebview): void => { void postTo<HostToWebview>(panel.webview, out); };
    const l10n = buildBulkDeployL10n();

    if (msg.type === 'ready') {
      post({
        type: 'init', l10n, sourceLabel: cfg.serverUrl ?? '',
        targets: targetOptions(serverId, cfg.serverUrl),
      });
      return;
    }

    // Read the list ANEW, do not show the one remembered on open: whoever
    // connects to the target only after opening would otherwise never find it.
    if (msg.type === 'targets') {
      post({ type: 'targets', targets: targetOptions(serverId, cfg.serverUrl) });
      return;
    }

    const gen = msg.gen;

    if (msg.type === 'search') {
      await handleBulkSearch(cfg, msg, l10n.loading, post);
      return;
    }

    // From here on every message needs the target server. It is read anew per request,
    // not remembered on open: between two requests a
    // connection may have been disconnected.
    const targetCfg = getServerConfig(msg.targetId);
    if (!targetCfg) {
      post({
        type: 'error', gen,
        message: vscode.l10n.t('Target server is not connected.'),
      });
      return;
    }
    // Second bolt behind the target list: the list is built on open,
    // the request runs later. If a profile for the same instance is added in
    // between, it would otherwise stand ready as a target.
    if (sameServer(targetCfg.serverUrl, cfg.serverUrl)) {
      post({
        type: 'error', gen,
        message: vscode.l10n.t('Source and target are the same server.'),
      });
      return;
    }

    if (msg.type === 'check') {
      post({ type: 'busy', on: true, label: l10n.checking, gen });
      try {
        const kinds = [...new Set(msg.rows.map(r => r.kind))];
        // The inventory of the TARGET and the reference index of the SOURCE — both are
        // a question to a whole server, both run once per request.
        const [inv, idx] = await Promise.all([
          readTargetInventory(targetCfg, kinds),
          getOrBuildIndex(cfg),
        ]);
        const checks = await checkDeployItems(cfg, msg.rows, inv, idx);
        forgetDocs();
        // Content only where there is something to compare with — a new
        // object has nothing over there.
        await mapLimit(checks.filter(c => c.check.exists), 4, async (c) => {
          c.check.content = await compareContent(cfg, targetCfg, c, compareKey(serverId, msg.targetId, c));
        });
        post({
          type: 'checks', checks: checks as CheckResult[], incomplete: idx.incomplete,
          inventoryFailed: inv.failed, gen,
        });
      } catch (err) {
        post({ type: 'error', message: errMsg(err), gen });
      } finally {
        post({ type: 'busy', on: false, gen });
      }
      return;
    }

    if (msg.type === 'diff') {
      const opened = await openCompareDiff(
        compareKey(serverId, msg.targetId, msg.ref), rowLabel(msg.ref),
        serverLabel(cfg.serverUrl, serverId), serverLabel(targetCfg.serverUrl, msg.targetId),
        msg.ref.kind);
      if (!opened) {
        post({ type: 'error', gen, message: vscode.l10n.t('Check the object again to compare it.') });
      }
      return;
    }

    if (msg.type !== 'deploy') { return; }
    const items = sortForDeploy(msg.items);
    if (items.length === 0) { return; }

    const targetLabel = serverLabel(targetCfg.serverUrl, msg.targetId);

    // Check prerequisites BEFORE writing — the same check as the
    // second step of the page, only unasked. A rule text without its cube,
    // a chore without its process, a view without its cube and a
    // subset without its dimension otherwise end in a bare HTTP 404 per
    // piece — this page does not carry cubes and dimensions, so the run cannot
    // heal that itself. The inventory has been read anyway:
    // the chore question below drops out along with it.
    post({ type: 'busy', on: true, label: l10n.checking, gen });
    let blocked: Map<string, string>;
    let existingChores: Set<string>;
    let knownTarget: KnownTarget;
    let targetSubsets: Set<string> | undefined;
    try {
      const kinds = [...new Set(items.map(i => i.kind))];
      const [inv, idx] = await Promise.all([
        readTargetInventory(targetCfg, kinds),
        getOrBuildIndex(cfg),
      ]);
      if (kinds.includes('chore') && inv.failed.includes('chore')) {
        throw new Error(vscode.l10n.t('The target server inventory is incomplete ({0} could not be read).', 'chore'));
      }
      existingChores = inv.chores;
      // A list that was not read is not an empty inventory: then ask live.
      targetSubsets = inv.failed.includes('subset') ? undefined : inv.subsets;
      knownTarget = { cubes: inv.failed.includes('cube') ? undefined : inv.cubes, subsets: targetSubsets };
      const checks = await checkDeployItems(cfg, items, inv, idx);
      const selectedKeys = new Set(items.map(i => rowKey(i)));
      blocked = new Map();
      for (const c of checks) {
        // What comes along in the same run is not missing (`openMissing`), and a
        // finding from a list that could not be read at all is
        // guessed — nothing is blocked on a guess here.
        const open = hardBlockers(c, openMissing(c.check, selectedKeys))
          .filter(m => !inv.failed.includes(MISSING_LIST[m.kind] ?? m.kind));
        if (open.length > 0) {
          blocked.set(rowKey(c), open.map(m => `${m.kind} ${rowLabel(m)}`).join(', '));
        }
      }
    } catch (err) {
      post({ type: 'error', message: errMsg(err), gen });
      return;
    } finally {
      post({ type: 'busy', on: false, gen });
    }
    const writable = items.filter(i => !blocked.has(rowKey(i)));
    const blockedItems = items.filter(i => blocked.has(rowKey(i)));
    const blockLine = (i: DeployRef): string =>
      `• ${rowLabel(i)} — ${blocked.get(rowKey(i)) ?? ''}`;

    // The confirmation stays with the host: there is no `confirm()` in the webview
    // sandbox. It names the TARGET SERVER — that is the detail whose
    // mix-up is most expensive here.
    const DEPLOY = vscode.l10n.t('Deploy');
    const skippedDetail = blockedItems.slice(0, 6).map(blockLine);
    const detail = writable.slice(0, 12).map(i => `• ${rowLabel(i)}`).join('\n')
      + (writable.length > 12 ? `\n… +${writable.length - 12}` : '')
      + (skippedDetail.length > 0 ? `\n${skippedDetail.join('\n')}` : '');
    if (writable.length === 0) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Nothing to deploy: every selected object is missing something on "{0}".', targetLabel)
        + `\n${skippedDetail.join('\n')}`);
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      vscode.l10n.t('Deploy {0} objects to "{1}"? Objects of the same name are overwritten there.',
        String(writable.length), targetLabel),
      { modal: true, detail },
      DEPLOY,
    );
    if (answer !== DEPLOY) { post({ type: 'busy', on: false, gen }); return; }

    // B6: the ONE question after flattening, before the run instead of per subset.
    //
    // `saveSubset` asks back when a target subset exists —
    // even when its state was not readable ("unknown asks too").
    // With 200 static subsets that was up to 200 modal windows in the middle
    // of the run, each with a GET of its own. It is only asked if it
    // hits a subset at all that already stands over there: otherwise the
    // question answers nothing.
    const overwrittenSubsets = writable.filter(i => i.kind === 'subset'
      && knownTarget.subsets?.has(
        `${(i.parent ?? '').toLowerCase()}|${(i.hierarchy ?? i.parent ?? '').toLowerCase()}`
        + `|${i.name.toLowerCase()}`));
    let flatten: FlattenChoice = 'all';
    if (overwrittenSubsets.length > 0) {
      const REPLACE = vscode.l10n.t('Replace');
      const SKIP = vscode.l10n.t('Skip those');
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          '{0} of the selected subsets already exist on "{1}". A dynamic subset there loses its MDX expression and becomes a fixed list.',
          String(overwrittenSubsets.length), targetLabel),
        { modal: true, detail: overwrittenSubsets.slice(0, 12).map(i => `• ${rowLabel(i)}`).join('\n') },
        REPLACE, SKIP,
      );
      if (pick === undefined) { post({ type: 'busy', on: false, gen }); return; }
      flatten = pick === SKIP ? 'skip' : 'all';
    }

    post({ type: 'busy', on: true, label: l10n.deploying, gen });
    const outcomes: DeployOutcome[] = blockedItems.map(i => ({
      ...i, ok: true, skipped: true,
      warn: vscode.l10n.t('{0}: not deployed, missing on the target server: {1}',
        rowLabel(i), blocked.get(rowKey(i)) ?? ''),
    }));
    const touchedKinds = new Set<DeployKind>();
    // Progress AND cancel: a run over hundreds of pieces used to show
    // only a fixed "Deploying…" in the window, and whoever closed the window
    // had a write run continuing without any display (the host
    // swallows the `postMessage` after closing). The path has long been in
    // `tree/deployViewsSubsets.ts` — it was only missing here.
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Deploying to "{0}"…', targetLabel),
      cancellable: true,
    }, async (progress, token) => {
      let done = 0;
      for (const item of writable) {
        done++;
        // Cancel does NOT mean done: the rest counts as skipped,
        // otherwise the report names more successes than there were.
        if (token.isCancellationRequested) {
          outcomes.push({ ...item, ok: true, skipped: true });
          continue;
        }
        progress.report({
          message: `${rowLabel(item)} (${done}/${writable.length})`,
          increment: 100 / writable.length,
        });
        try {
          // The inventory is still there from the check step: without it the
          // view copy asks again for cube and subsets, although both were already read in
          // bulk.
          const res = await deployOne(item, cfg, targetCfg,
            item.kind === 'chore' && existingChores.has(item.name.toLowerCase()),
            knownTarget, flatten);
          // Just created: a later view of the same run refers to it.
          if (item.kind === 'subset' && res !== 'cancelled') {
            targetSubsets?.add(`${(item.parent ?? '').toLowerCase()}|${(item.hierarchy ?? item.parent ?? '').toLowerCase()}`
              + `|${item.name.toLowerCase()}`);
          }
          outcomes.push({
            ...item, ok: true, skipped: res === 'cancelled',
            warn: typeof res === 'object' ? res.warn : undefined,
          });
        } catch (err) {
          // No exit on an ERROR: otherwise the selection hangs half
          // transferred in the air, and which half, one would have to guess.
          // The user's cancel above is something else — that one is intended.
          outcomes.push({ ...item, ok: false, reason: errMsg(err) });
        }
        touchedKinds.add(item.kind);
      }
    });

    for (const kind of touchedKinds) {
      for (const ep of INVALIDATES[kind] ?? []) { invalidateCache(ep, targetCfg.serverUrl); }
    }
    invalidateReferenceIndex(targetCfg);
    BulkDeployPanel.refreshTree();

    const ok = outcomes.filter(o => o.ok && !o.skipped).length;
    const skipped = outcomes.filter(o => o.skipped).length;
    const bad = outcomes.filter(o => !o.ok).length;
    // Written, but not completely — that stands between success and
    // error and must not get lost in either of the two messages.
    const warned = outcomes.filter(o => o.warn);
    if (bad === 0 && warned.length > 0) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('TM1: {0} deployed to "{1}", {2} with warnings:',
          String(ok), targetLabel, String(warned.length))
        + '\n' + warned.slice(0, 3).map(o => `• ${o.warn ?? ''}`).join('\n'));
    } else if (bad === 0) {
      vscode.window.showInformationMessage(skipped > 0
        ? vscode.l10n.t('TM1: {0} deployed to "{1}", {2} skipped.',
          String(ok), targetLabel, String(skipped))
        : vscode.l10n.t('TM1: {0} deployed to "{1}".', String(ok), targetLabel));
    } else {
      const first = outcomes.filter(o => !o.ok).slice(0, 3)
        .map(o => `• ${rowLabel(o)}: ${o.reason ?? ''}`).join('\n');
      const warnLines = warned.slice(0, 3).map(o => `• ${o.warn ?? ''}`).join('\n');
      vscode.window.showWarningMessage(
        vscode.l10n.t('TM1: {0} deployed, {1} failed:', String(ok), String(bad))
        + `\n${first}` + (warnLines ? `\n${warnLines}` : ''));
    }
    post({ type: 'done', outcomes });
    post({ type: 'busy', on: false, gen });
  }
}
