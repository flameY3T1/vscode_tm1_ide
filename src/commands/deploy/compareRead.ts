// src/commands/deploy/compareRead.ts
// Reads one object as a comparison document (see `webviews/bulkComparePure`)
// and shows two of them side by side in VS Code's diff editor.
//
// A process reads like the Git mirror: its header is the very JSON the mirror
// writes next to the `.ti` file, then the four code sections. Left out on
// purpose: the ODBC password (the mirror strips it too) and `UIData`
// (Architect wizard state — not executed, and it would flag "Header" as
// different on processes whose behaviour is identical).

import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { fetchProcess } from '../../git/processFetcher';
import { serializeProcess } from '../../git/serializer';
import { fetchRulesText } from '../../git/rulesApi';
import { getChoreDetail } from '../../tm1Rest/choreApi';
import { mapChoreDetailFromApi } from '../chore/choreEditorPure';
import { getSubset, listSubsetElementNames } from '../../tm1Rest/subsetApi';
import { readViewForCopy } from '../../tm1Rest/viewCopyApi';
import { CHORE_ACTIVE_PART, CHORE_MODE_PART, renderParts, type Parts } from '../../webviews/bulkComparePure';
import type { DeployItem } from './deployCheck';

const json = (v: unknown): string => JSON.stringify(v ?? null, null, 2);

async function processDoc(cfg: Tm1Config, name: string): Promise<Parts> {
  const p = await fetchProcess(name, cfg);
  // One layout for both sides: v11 and v12 differ in key order and v12 may omit
  // VariablesUIData — neither is a difference between the two processes.
  const header = serializeProcess({ ...p, uiData: undefined, variablesUiData: p.variablesUiData ?? [], v12: false }).headerJson;
  return [
    ['Header', header],
    ['Prolog', p.prolog],
    ['Metadata', p.metadata],
    ['Data', p.data],
    ['Epilog', p.epilog],
  ];
}

/**
 * A chore in the same shape as a process: the TM1 REST fields as JSON. Read
 * through the chore editor's mapper, so the server's variant of the detail
 * read (some report parameter values as numbers) does not show as a
 * difference. `ExecutionMode` is its own part: the last variants do not ask
 * for it, so the host compares it only when both sides report it. `Active` stands apart — it may differ
 * between servers on purpose and is not counted.
 */
async function choreDoc(cfg: Tm1Config, name: string): Promise<Parts> {
  const c = mapChoreDetailFromApi((await getChoreDetail(cfg, name)).data as { Name: string });
  return [
    ['Header', json({
      Name: c.Name,
      StartTime: c.StartTime,
      Frequency: c.Frequency,
      DSTSensitive: c.DST,
    })],
    ...(c.ExecutionMode ? [[CHORE_MODE_PART, c.ExecutionMode] as const] : []),
    ['Tasks', json(c.Tasks.map((t, i) => ({
      Step: i + 1,
      Process: t.processName,
      Parameters: t.Parameters.map(p => ({ Name: p.Name, Value: p.Value })),
    })))],
    [CHORE_ACTIVE_PART, String(c.Active)],
  ];
}

async function subsetDoc(cfg: Tm1Config, dim: string, hier: string, name: string): Promise<Parts> {
  const s = await getSubset(cfg, dim, hier, name, false);
  if (!s.ok) { throw new Error(vscode.l10n.t('Subset "{0}" could not be read.', name)); }
  const expression = String(s.Expression ?? '').trim();
  if (expression) {
    return [['Alias', s.Alias ?? ''], ['Expression', expression]];
  }
  const list = await listSubsetElementNames(cfg, dim, hier, name, false, 60000);
  if (!list.complete) {
    throw new Error(vscode.l10n.t('Members of subset "{0}" could not be read completely.', name));
  }
  return [['Alias', s.Alias ?? ''], ['Elements', list.elements.join('\n')]];
}

async function viewDoc(cfg: Tm1Config, cube: string, view: string): Promise<Parts> {
  const v = await readViewForCopy(cfg, cube, view, false, view);
  if (!v || v.kind === 'other') {
    throw new Error(vscode.l10n.t('View "{0}" could not be read.', view));
  }
  return v.kind === 'mdx'
    ? [['MDX', v.mdx ?? '']]
    : [['Definition', json(v.plan?.body)]];
}

/** The comparison document of one object. Throws when it cannot be read. */
export async function readCompareDoc(cfg: Tm1Config, item: DeployItem): Promise<Parts> {
  switch (item.kind) {
    case 'process': return processDoc(cfg, item.name);
    case 'rule': return [['Rules', await fetchRulesText(item.parent ?? item.name, cfg)]];
    case 'chore': return choreDoc(cfg, item.name);
    case 'subset':
      return subsetDoc(cfg, item.parent ?? '', item.hierarchy ?? item.parent ?? '', item.name);
    case 'view': return viewDoc(cfg, item.parent ?? '', item.name);
  }
}

// ── Diff editor ──────────────────────────────────────────────────────────────

const SCHEME = 'tm1-compare';
/**
 * Documents of the last check, by URI path. `forgetDocs` empties it before
 * each check — keys include source, target and object, so nothing else would
 * ever drop a text.
 */
const docs = new Map<string, string>();
let registered = false;
/**
 * VS Code keeps a virtual document's text once opened — without this event a
 * diff left open would keep showing the state of the previous check.
 */
const changed = new vscode.EventEmitter<vscode.Uri>();

function ensureProvider(): void {
  if (registered) { return; }
  registered = true;
  // Lives as long as the extension — the documents are only kept here.
  vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent: (uri) => docs.get(uri.path) ?? '',
  });
}

function docUri(side: string, key: string, label: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/${side}/${encodeURIComponent(key)}/${encodeURIComponent(label)}` });
}

/** Drop the documents of the previous check. Bulk Deploy is a single panel. */
export function forgetDocs(): void {
  docs.clear();
}

/** Keep both documents of one row so the diff can be opened later. */
export function rememberDocs(key: string, label: string, source: Parts, target: Parts): void {
  for (const [side, parts] of [['source', source], ['target', target]] as const) {
    const text = renderParts(parts);
    const uri = docUri(side, key, label);
    docs.set(uri.path, text);
    if (registered) { changed.fire(uri); }
  }
}

/**
 * Syntax colouring for the diff. Set on the document, not through a `.ti`/`.rux`
 * file name: the TI and rules linters key on the file name, and would lint
 * the JSON header (and send the rules to the server for a check).
 */
const LANGUAGE: Partial<Record<DeployItem['kind'], string>> = { process: 'ti', rule: 'tm1rules' };

/** Open the diff of a row compared before. `false` when nothing is kept for it. */
export async function openCompareDiff(
  key: string, label: string, sourceName: string, targetName: string, kind: DeployItem['kind'],
): Promise<boolean> {
  const left = docUri('source', key, label);
  const right = docUri('target', key, label);
  if (!docs.has(left.path)) { return false; }
  ensureProvider();
  const language = LANGUAGE[kind];
  if (language) {
    for (const uri of [left, right]) {
      await vscode.languages.setTextDocumentLanguage(await vscode.workspace.openTextDocument(uri), language);
    }
  }
  await vscode.commands.executeCommand('vscode.diff', left, right,
    vscode.l10n.t('{0} ({1} ↔ {2})', label, sourceName, targetName));
  return true;
}
