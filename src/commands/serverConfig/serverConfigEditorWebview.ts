import * as vscode from 'vscode';
import { resolveWritePath, schemaFor, type ConfigSnapshot } from '../../serverConfig/configApi';
import { PARAM_SCHEMA, allClusters, lookupLeafInfo, normalizeEnumRead, type Cluster } from '../../serverConfig/paramSchema';
import { resolveReadAlias, aliasNames, aliasCoveredLeaves, legacyEchoNames, legacyEchoOf, isIsoDuration, isoDurationToSeconds } from '../../serverConfig/configAlias';
import { classify } from '../../serverConfig/configClassifier';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { escapeHtml } from '../../utils/escapeHtml';
import type { ServerConfigBootstrap } from '../../webviewClient/serverConfigEditor/protocol';

interface IconUris {
  saveLight: string; saveDark: string;
  refreshLight: string; refreshDark: string;
}

function buildIconUris(webview?: vscode.Webview, extensionUri?: vscode.Uri): IconUris {
  const empty: IconUris = { saveLight: '', saveDark: '', refreshLight: '', refreshDark: '' };
  if (!webview || !extensionUri || typeof webview.asWebviewUri !== 'function') { return empty; }
  const u = (theme: 'light' | 'dark', name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'icons', theme, `${name}.svg`)).toString();
  return {
    saveLight:    u('light', 'save'),
    saveDark:     u('dark',  'save'),
    refreshLight: u('light', 'refresh'),
    refreshDark:  u('dark',  'refresh'),
  };
}

function capitalizeCluster(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

interface RowVM {
  name: string; cluster: Cluster; value: unknown;
  type: string; enumValues?: string[];
  isStatic: boolean; requiresRestart: boolean; readonly: boolean;
  description: string; defaultValue?: unknown; known: boolean;
  /**
   * The server's config tree has no leaf for this param, so a PATCH would earn a
   * `400 code 278`. Derived from the snapshot, never from a hardcoded version list: the v12
   * test server exposes CacheFriendlyMalloc, DisableMemoryCache, LockPagesInMemory and
   * ApplyMaximumViewSizeToEntireTransaction even though IBM lists all four as removed in
   * TM1 12. Asking the server covers both directions and needs no upkeep.
   */
  unavailable: boolean;
}

function inferType(value: unknown): 'string' | 'number' | 'bool' {
  if (typeof value === 'boolean') { return 'bool'; }
  if (typeof value === 'number') { return 'number'; }
  return 'string';
}

/**
 * Description text of a row. For a read alias, the origin is appended —
 * without it, the mask would show a value whose source the user does not
 * see, next to a field that cannot be changed.
 */
function describe(name: string, base: string | undefined, isNested: boolean, alias?: { leaf: string }, duration = false): string {
  const text = base ?? (isNested
    ? `Nested config-leaf: ${name}`
    : vscode.l10n.t('(unknown parameter — best-effort via StaticConfiguration)'));
  if (alias) {
    return text + ' ' + vscode.l10n.t('Stored by the server as "{0}".', alias.leaf);
  }
  if (duration) {
    return text + ' ' + vscode.l10n.t('Shown and entered in seconds; the server stores it as a duration.');
  }
  return text;
}

function buildRows(snap: ConfigSnapshot): RowVM[] {
  const rows: RowVM[] = [];
  const seen = new Set<string>();

  /**
   * The value of a tm1s.cfg name from its differently named leaf — but only
   * when the usual path finds nothing. Otherwise the alias would win over a
   * real hit, and that would be a regression.
   */
  const aliasFor = (name: string) =>
    writable(snap, name) ? undefined : resolveReadAlias(name, snap.values, snap.paths);

  /**
   * "Static" in TM1 means "only takes effect after a restart", not
   * "unchangeable". For an alias row, the flag of the LEAF the value comes
   * from applies — measured on 11.8 on 2026-08-31: all five affected leaves
   * are in Static AND Active, so they take effect immediately.
   */
  const restartFromLeaf = (leaf: string) => snap.staticKeys.has(leaf) && !snap.activeKeys.has(leaf);

  // Every leaf the server exposes, whether or not it currently holds a value. `values` only
  // carries the configured ones, so without this pass a param that exists but is unset is
  // invisible — and that is exactly the param someone opens this editor to set. 11.8 hides
  // 26 leaves that way, v12 hides LegacyTransactionLog among others.
  // A flat legacy name from /Configuration that resolves onto one of those leaves is the same
  // setting under its old tm1.cfg name (PortNumber → Access.CAPI.Port). Showing both would
  // offer two editors writing the same target.
  const shadowed = (name: string) => {
    const target = resolveWritePath(name, snap.paths);
    return target !== undefined && target !== name;
  };
  // `resolveWritePath` only chases a rename/nesting when it's handed the FLAT name — for a
  // dotted input it just checks the dotted path exists (see its own root-vs-nested comment).
  // So when both "ServerName" and "Administration.ServerName" are members of `snap.paths` —
  // measured live on 11.8 — `shadowed()` alone never catches the nested one, because it's
  // never asked about the flat leaf. Ask it here: chase the nested entry's OWN leaf and drop
  // the nested row if that leaf resolves to a different (root) path. Without this, both rows
  // render with the identical schema (leaf-name lookup) and description.
  const nestedShadowedByRoot = (name: string) => {
    if (!name.includes('.')) { return false; }
    const leaf = name.split('.').pop()!;
    const target = resolveWritePath(leaf, snap.paths);
    return target !== undefined && target !== name;
  };
  // Leaves that already appear under their tm1s.cfg name get no second row.
  // Only when the alias actually delivers a value too — otherwise the leaf
  // would be hidden and nothing visible in its place.
  const aliasHidden = new Set<string>();
  for (const n of aliasNames()) {
    if (aliasFor(n)) { for (const leaf of aliasCoveredLeaves(n)) { aliasHidden.add(leaf); } }
  }
  // And the same for the read-only echoes of the old view: as long as the
  // changeable counterpart exists, the echo just stands beside it and says
  // the same thing. If it's missing, the echo stays — then it's the only
  // information available.
  for (const n of legacyEchoNames()) {
    if (writable(snap, legacyEchoOf(n)!)) { aliasHidden.add(n); }
  }

  const names = [
    ...[...snap.paths].filter(p => !aliasHidden.has(p) && !nestedShadowedByRoot(p)),
    ...[...snap.values.keys()].filter(n => !snap.paths.has(n) && !shadowed(n) && !aliasHidden.has(n)),
  ];

  for (const name of names) {
    const value = snap.values.get(name);
    seen.add(name);
    const cls = classify(name);
    const isNested = name.includes('.');
    // For nested keys (e.g. "Modelling.EnableNewHierarchyCreation") the schema is keyed
    // by the flat leaf name. Look up the leaf so we can inherit the correct restart flag,
    // type, description, etc. — TM1 11.x reports many params under both flat /Configuration
    // and nested /StaticConfiguration, and the snapshot heuristic alone (static-only ⇒
    // restart) is wrong for params that also appear in /ActiveConfiguration but still
    // require a server restart to take effect (EnableNewHierarchyCreation is exactly this).
    // Two paths to the schema: via the last segment (`Modelling.Language` ->
    // `Language`) and via the reverse of the rewrite table
    // (`Access.CAPI.Port` -> `PortNumber`). Without the second, the row
    // would stand there without a description, because the flat row was
    // suppressed after all.
    // `save()` needs the SAME resolution — that's why it lives in `schemaFor`.
    const effDef = schemaFor(name);
    // Only description and type, no restart flag: that one stays with the
    // snapshot, because it is measured there rather than guessed. See the
    // header of LEAF_INFO_RAW.
    const leafInfo = effDef ? undefined : lookupLeafInfo(name);
    // Cluster (= tab) in this order: the entry's own schema entry, then the
    // leaf's, then as a last resort the first path segment.
    //
    // The last resort was the normal case until 2026-08-31, and that's why
    // the tab bar got jumbled: nested rows ended up in four clusters born
    // from the path (`access`, `administration`, `modelling`,
    // `performance`), while the ten named ones stayed largely empty. On
    // both test instances the last resort now applies to NO leaf anymore.
    const derivedCluster = isNested ? name.split('.')[0].toLowerCase() : cls.cluster;
    const alias = aliasFor(name);
    // A duration comes in as `P0DT01H00M00S`. In the mask it is shown as a
    // number of seconds, so it can be entered; the description says so.
    const duration = !alias && isIsoDuration(value);
    const shown = alias ? alias.value : normalizeEnumRead(effDef, duration ? isoDurationToSeconds(value) : value);
    // "Not writable" and "doesn't exist here" are two different situations,
    // and until 2026-08-31 both carried the same N/A flag. The flat keys of
    // the old `/Configuration` view (SecurityMode, ProductVersion,
    // ClientCAMURIs, WebCAMURI, PrincipalName, DistributedOutputDir) DO have
    // a value, but do not accept a PATCH: all six live, sent with their own
    // value, all six `400 Code 278 Invalid ServerSettings property`.
    // That is write-protected, not absent.
    const notWritable = !alias && !writable(snap, name);
    rows.push({
      name,
      value: shown,
      cluster: cls.known
        ? cls.cluster
        : (effDef?.cluster ?? leafInfo?.cluster ?? (derivedCluster as Cluster)),
      type: alias || duration ? 'number' : (effDef?.type ?? leafInfo?.type ?? inferType(value)),
      enumValues: effDef?.enumValues,
      isStatic: alias ? restartFromLeaf(alias.leaf) : (effDef ? effDef.isStatic : (snap.staticKeys.has(name) && !snap.activeKeys.has(name))),
      requiresRestart: alias ? restartFromLeaf(alias.leaf) : (effDef ? effDef.requiresRestart : (snap.staticKeys.has(name) && !snap.activeKeys.has(name))),
      readonly: (effDef ? (effDef.readonly === true) : cls.readonly) || (notWritable && shown !== undefined),
      description: describe(name, effDef?.description ?? leafInfo?.description, isNested, alias, duration),
      defaultValue: effDef?.defaultValue,
      known: !!effDef || !!leafInfo || cls.known,
      unavailable: notWritable && shown === undefined,
    });
  }
  // Build a suffix-set of nested keys so we can drop schema entries that are
  // duplicates of nested-API leaves (e.g. flat `EnableNewHierarchyCreation` is
  // shadowed by nested `Modelling.EnableNewHierarchyCreation`). Otherwise we'd
  // show the param twice — once empty in storage, once populated in modelling.
  const nestedSuffixes = new Set<string>();
  for (const k of seen) {
    if (k.includes('.')) {
      nestedSuffixes.add(k.split('.').pop()!);
    }
  }
  for (const def of PARAM_SCHEMA) {
    // `shadowed` catches the renames the suffix-set cannot see, where the tm1.cfg name and
    // the REST leaf differ outright (PortNumber → Access.CAPI.Port). What survives here is a
    // param the server has no leaf for at all — kept on purpose and marked N/A, so looking it
    // up answers "not on this server" instead of turning up nothing.
    if (seen.has(def.name) || nestedSuffixes.has(def.name) || shadowed(def.name)) { continue; }
    const alias = aliasFor(def.name);
    rows.push({
      name: def.name,
      value: alias ? alias.value : undefined,
      cluster: def.cluster,
      type: def.type,
      enumValues: def.enumValues,
      isStatic: alias ? restartFromLeaf(alias.leaf) : def.isStatic,
      requiresRestart: alias ? restartFromLeaf(alias.leaf) : def.requiresRestart,
      readonly: def.readonly === true,
      description: describe(def.name, def.description, false, alias),
      defaultValue: def.defaultValue,
      known: true,
      unavailable: alias ? false : !writable(snap, def.name),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A param is offered for editing only if the server's own config tree has a leaf for it.
 * On v12 that removes most of the schema by itself — its tree carries 64 leaves against
 * 158 on 11.8, with the whole Access group (ports, SSL, CAM, LDAP) gone. A snapshot without
 * paths (server served neither nested endpoint) keeps every row editable, as before.
 */
function writable(snap: ConfigSnapshot, name: string): boolean {
  return snap.paths.size === 0 || resolveWritePath(name, snap.paths) !== undefined;
}

export function renderHtml(snap: ConfigSnapshot, serverName: string, webview?: vscode.Webview, extensionUri?: vscode.Uri): string {
  const rows = buildRows(snap);
  const original: Record<string, unknown> = {};
  for (const r of rows) { if (r.value !== undefined) { original[r.name] = r.value; } }
  // Cluster list = union of hardcoded schema clusters + any dynamic clusters derived
  // from nested-key first-segments (e.g. "modelling", "access" on PA 11.8 nested API).
  // Sorted with hardcoded clusters first to preserve familiar ordering.
  const knownClusters = allClusters();
  const dynamicClusters = Array.from(new Set(rows.map(r => r.cluster))).filter(c => !knownClusters.includes(c));
  const clusterList = [...knownClusters, ...dynamicClusters.sort()];
  const initialCluster = clusterList[0] ?? 'misc';
  const icons = buildIconUris(webview, extensionUri);
  const cspSource = webview?.cspSource ?? '';
  const css = `
  body{font:13px/1.4 var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:0;}
  header{padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;gap:8px;align-items:center;}
  header h1{margin:0;font-size:14px;flex:1;}
  /* Toolbar buttons styled like the TI process editor: transparent ghost buttons
     with subtle hover, NOT the prominent vscode-button-background. */
  header button{background:transparent;color:var(--vscode-foreground);border:1px solid transparent;padding:4px 10px;cursor:pointer;border-radius:4px;font-size:12px;}
  header button:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18));border-color:var(--vscode-toolbar-hoverOutline,transparent);}
  header button:active:not(:disabled){background:var(--vscode-toolbar-activeBackground,rgba(128,128,128,0.28));}
  header button:disabled{opacity:.5;cursor:default;}
  header button.icon-btn{display:inline-flex;align-items:center;gap:6px;}
  header button.icon-btn .btn-icon{width:16px;height:16px;flex-shrink:0;pointer-events:none;}
  header button.icon-btn .btn-icon.dark-only{display:none;}
  body.vscode-dark header button.icon-btn .btn-icon.light-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) header button.icon-btn .btn-icon.light-only{display:none;}
  body.vscode-dark header button.icon-btn .btn-icon.dark-only,
  body.vscode-high-contrast:not(.vscode-high-contrast-light) header button.icon-btn .btn-icon.dark-only{display:inline-flex;}
  .filters{padding:6px 12px;border-bottom:1px solid var(--vscode-panel-border);display:flex;gap:12px;align-items:center;}
  .filters input[type=text]{flex:1;padding:3px 6px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border, var(--vscode-panel-border));}
  .tabs{display:flex;align-items:stretch;background:var(--vscode-tab-inactiveBackground);border-bottom:1px solid var(--vscode-panel-border);overflow-x:auto;flex-shrink:0;}
  .tabs button{background:transparent;color:var(--vscode-tab-inactiveForeground);border:0;border-right:1px solid var(--vscode-panel-border);padding:6px 16px;font-size:12px;cursor:pointer;user-select:none;}
  .tabs button:hover{background:var(--vscode-tab-hoverBackground);}
  .tabs button.active{background:var(--vscode-tab-activeBackground);color:var(--vscode-tab-activeForeground);border-bottom:2px solid var(--vscode-focusBorder);padding-bottom:4px;}
  main{padding:8px 12px;}
  .row{display:grid;grid-template-columns:280px 1fr 80px;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--vscode-panel-border);}
  .row.dirty{border-left:3px solid var(--vscode-gitDecoration-modifiedResourceForeground);padding-left:6px;}
  .row .name-cell{min-width:0;}
  .row .name{font-family:var(--vscode-editor-font-family);font-weight:600;word-break:break-word;}
  .row .name-parent{font-family:var(--vscode-editor-font-family);font-size:11px;opacity:.55;display:block;margin-bottom:2px;}
  .row .desc{font-style:italic;font-size:11px;opacity:.7;margin-top:3px;line-height:1.35;}
  .row input,.row select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border, var(--vscode-panel-border));padding:3px 6px;box-sizing:border-box;font:inherit;}
  .row input[type=text]{width:340px;max-width:100%;}
  .row input[type=number]{width:140px;}
  .row select{width:220px;max-width:100%;}
  .row .ro-value{font-family:var(--vscode-editor-font-family);opacity:.85;}
.row .na-value{opacity:.5;font-style:italic;}
  /* Bool toggle: checkbox + enabled/disabled label as a single click target */
  .row .bool-toggle{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:2px 0;}
  .row .bool-toggle input[type=checkbox]{width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--vscode-focusBorder);}
  .row .bool-toggle .bool-state{font-size:11px;opacity:.8;min-width:60px;}
  .row .bool-toggle input[type=checkbox]:checked + .bool-state{color:var(--vscode-charts-green,#3a9a3a);opacity:1;}
  .badge{font-size:10px;padding:1px 4px;border-radius:3px;text-align:center;}
  .badge.DYNAMIC{background:#3a9a3a;color:#fff;}
  .badge.READONLY{background:#666;color:#fff;}
  .badge.STATIC{background:#c62828;color:#fff;}
  .raw textarea{width:100%;height:60vh;font-family:var(--vscode-editor-font-family);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border, var(--vscode-panel-border));}
`;
  const body = `
<header>
  <h1>TM1 Konfiguration — ${escapeHtml(serverName)}</h1>
  <button id="reload" class="icon-btn" title="${vscode.l10n.t('Reload configuration')}">${icons.refreshLight ? `<img class="btn-icon light-only" src="${icons.refreshLight}" alt=""><img class="btn-icon dark-only" src="${icons.refreshDark}" alt="">` : ''}Reload</button>
  <button id="save" class="icon-btn" disabled title="${vscode.l10n.t('Save changes')}">${icons.saveLight ? `<img class="btn-icon light-only" src="${icons.saveLight}" alt=""><img class="btn-icon dark-only" src="${icons.saveDark}" alt="">` : ''}${vscode.l10n.t('Save')}</button>
</header>
<div class="filters">
  <input id="search" type="text" placeholder="${vscode.l10n.t('Search…')}"/>
  <label><input type="checkbox" id="dirty"/> ${vscode.l10n.t('only changed')}</label>
  <label><input type="checkbox" id="nondef"/> ${vscode.l10n.t('only non-default')}</label>
</div>
<div class="tabs" id="tabs">
  ${clusterList.map((c,i) => `<button data-cluster="${escapeHtml(c)}"${i===0?' class="active"':''}>${escapeHtml(capitalizeCluster(c))}</button>`).join('')}
  <button data-cluster="__raw__">Raw JSON</button>
</div>
<main id="main"></main>
`;
  const bootstrap: ServerConfigBootstrap = {
    rows,
    original,
    clusters: [...clusterList, '__raw__'],
    initialCluster,
    texts: {
      enabled: vscode.l10n.t('Enabled'),
      disabled: vscode.l10n.t('Disabled'),
      noParams: vscode.l10n.t('No parameters visible.'),
      notOnThisServer: vscode.l10n.t('This server does not know this parameter — it cannot be written here.'),
    },
  };
  return renderWebviewShell({
    cspSource, css, body,
    // The shell serializes globals injection-safe (</script>, U+2028/9).
    globals: { __serverConfig: bootstrap },
    scriptUris: extensionUri && webview ? [String(webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'serverConfigEditor.js')))] : [],
  });
}
