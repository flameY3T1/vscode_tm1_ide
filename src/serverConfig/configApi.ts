import * as vscode from 'vscode';
import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { classify } from './configClassifier';
import { coerceType } from './configDiff';
import { lookupSchema, type ParamDef } from './paramSchema';
import { resolveWriteAlias, isIsoDuration, secondsToIsoDuration } from './configAlias';
import { errMsg } from '../utils/errMsg';
import { isOk } from '../tm1Rest/httpError';

export interface ConfigSnapshot {
  values: Map<string, unknown>;
  staticKeys: Set<string>;
  activeKeys: Set<string>;
  /**
   * Every leaf path the server's nested config exposes — including the ones whose value
   * is null. `values`/`staticKeys` only carry configured params, so they cannot tell save()
   * where an *unset* param belongs. See collectPaths().
   */
  paths: Set<string>;
}

/**
 * Recursively flatten a nested config object into dotted-path leaves.
 * TM1 11.8 returns /StaticConfiguration and /ActiveConfiguration as deeply nested
 * objects ({Modelling: {EnableNewHierarchyCreation: true}, ...}) while /Configuration
 * is a flat 22-key legacy view. To present a uniform editable surface we flatten
 * everything to "Modelling.EnableNewHierarchyCreation" leaves and un-flatten on save.
 *
 * Arrays are kept as leaf values (TM1 uses arrays for ClientCAMURIs etc.).
 * null leaves are dropped (server convention for "not set").
 */
export function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) { continue; }
    const path = prefix ? `${prefix}.${k}` : k;
    if (v === null) { continue; }
    if (typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

/**
 * Like flatten(), but collects only the leaf PATHS and keeps null leaves.
 *
 * Live 11.8: /StaticConfiguration reports 158 leaves, 129 of them null (= "not set in
 * tm1.cfg"). flatten() drops those, so a snapshot-derived key set knows the nesting of
 * configured params only. A param the user configures for the FIRST time is exactly the
 * null case — dropping it leaves save() without a path, the flat name lands at the root
 * of the payload, and TM1 answers `400 code 278 "Invalid ServerSettings property
 * encountered in payload."`. Path knowledge must survive null values.
 */
export function collectPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@')) { continue; }
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectPaths(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Inverse of flatten: given a Map of dotted-path → value, build a nested object.
 * Used by save() to construct the PATCH body that TM1's nested endpoints expect.
 */
export function unflatten(entries: Iterable<[string, unknown]>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, val] of entries) {
    const segs = path.split('.');
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      const next = cur[seg];
      if (next === undefined || typeof next !== 'object' || next === null || Array.isArray(next)) {
        cur[seg] = {};
      }
      cur = cur[seg] as Record<string, unknown>;
    }
    cur[segs[segs.length - 1]] = val;
  }
  return root;
}

function parseODataObject(endpoint: string, body: string): Record<string, unknown> {
  if (!body) { return {}; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    const excerpt = body.length > 120 ? body.slice(0, 120) + '…' : body;
    throw new Error(vscode.l10n.t('GET /{0}: invalid JSON ({1})', endpoint, excerpt));
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

function parseODataBody(endpoint: string, body: string): Record<string, unknown> {
  return flatten(parseODataObject(endpoint, body));
}

// apiRequest does NOT throw on non-2xx HTTP responses — it returns them as
// {statusCode, body}. The catch here only fires on actual rejection (network,
// TLS, DNS). For the optional Static/Active endpoints we treat ALL such
// failures as "endpoint unavailable" so the editor still opens with effective
// config visible. The primary /Configuration call has no catch, so genuine
// network outages still surface to the user.
function _swallowFetchError(e: unknown) { return { statusCode: 0, body: String(e) }; }

export async function fetchAll(cfg: Tm1Config): Promise<ConfigSnapshot> {
  const [eff, stat, act] = await Promise.all([
    apiRequest('GET', 'Configuration', undefined, undefined, cfg),
    apiRequest('GET', 'StaticConfiguration', undefined, undefined, cfg).catch(_swallowFetchError),
    apiRequest('GET', 'ActiveConfiguration', undefined, undefined, cfg).catch(_swallowFetchError),
  ]);

  if (!isOk(eff)) {
    throw new Error(vscode.l10n.t('GET /Configuration failed: HTTP {0} {1}', String(eff.statusCode), eff.body));
  }

  const effObj  = parseODataBody('Configuration', eff.body);
  const statRaw = (isOk(stat)) ? parseODataObject('StaticConfiguration', stat.body) : {};
  const actRaw  = (isOk(act))   ? parseODataObject('ActiveConfiguration', act.body)  : {};
  const statObj = flatten(statRaw);
  const actObj  = flatten(actRaw);

  // Union of both nested endpoints: they report the same 158 leaves on 11.8, but a server
  // that serves only one of them still yields usable path knowledge for save().
  const paths = new Set([...collectPaths(statRaw), ...collectPaths(actRaw)]);

  // Merge precedence: StaticConfiguration wins over ActiveConfiguration wins over /Configuration.
  // Static = the value persisted in tm1.cfg (source of truth for the editor — what the user
  // actually configured). Active = the runtime-effective value, which can lag the cfg when a
  // change requires a server restart (e.g. EnableNewHierarchyCreation flipped to false in cfg
  // would still report true in /ActiveConfiguration until restart). Reflecting the cfg value
  // is what the user expects on reload after save.
  const merged: Record<string, unknown> = { ...effObj, ...actObj, ...statObj };

  return {
    values:     new Map(Object.entries(merged)),
    staticKeys: new Set(Object.keys(statObj)),
    activeKeys: new Set(Object.keys(actObj)),
    paths,
  };
}

export interface SaveError { target: 'static' | 'validation'; statusCode?: number; param?: string; message: string; }
export interface SaveResult { errors: SaveError[]; restartNeeded: string[]; }
export interface SaveHint {
  staticKeys?: Set<string>;
  activeKeys?: Set<string>;
  paths?: Set<string>;
  /**
   * The tree read last. Needed in order to recognize, when writing,
   * that a leaf carries an ISO-8601 duration — the form shows seconds there,
   * TM1 wants `P0DT00H05M00S` back.
   */
  values?: ReadonlyMap<string, unknown>;
}

/**
 * Hardcoded fallback nesting for params not in /StaticConfiguration snapshot
 * but still PATCH-able. Without this the flat name lands at root → HTTP 400
 * "Invalid ServerSettings property encountered in payload."
 * Add entries as discovered. Keys are flat schema-names.
 */
const STATIC_PATCH_PATH_OVERRIDES: Record<string, string> = {
  EnableSandboxDimension: 'Administration.EnableSandboxDimension',
  DisableSandboxing:      'Administration.DisableSandboxing',

  // Params whose tm1.cfg name differs from the REST leaf name, so the suffix scan over the
  // snapshot paths cannot find them. Every path below was PATCHed against live 11.8
  // (11.8.02900.8) writing the current value back — all answered 200.
  PortNumber:                 'Access.CAPI.Port',
  ClientMessagePortNumber:    'Access.CAPI.ClientMessagePort',
  HTTPPortNumber:             'Access.HTTP.Port',
  UseSSL:                     'Access.SSL.Enable',
  SSLCertificateID:           'Access.SSL.CertificateID',
  SSLCertAuthority:           'Access.SSL.CertAuthority',
  ClientCAMURI:               'Access.CAM.ClientURI',
  CAMPortalVariableFile:      'Access.CAM.PortalVariableFile',
  LDAPHost:                   'Access.LDAP.Host',
  LDAPPort:                   'Access.LDAP.Port',
  AuditLogOn:                 'Administration.AuditLog.Enable',
  AuditLogMaxFileSize:        'Administration.AuditLog.MaxFileSizeKilobytes',
  AuditLogMaxQueryMemory:     'Administration.AuditLog.MaxQueryMemoryKilobytes',
  EventLogging:               'Administration.EventLog.Enable',
  MTCubeLoad:                 'Performance.MTCubeLoad.Enabled',
  JobQueuing:                 'Performance.JobQueuing.Enable',
  JobQueueThreadPoolSize:     'Performance.JobQueuing.ThreadPoolSize',
  MaximumViewSize:            'Performance.Memory.MaximumViewSizeMB',
  MaximumMemoryForSubsetUndo: 'Performance.Memory.MaximumMemoryForSubsetUndoKB',
  MaximumUserSandboxSize:     'Performance.Memory.MaximumUserSandboxSizeMB',

  // Four more do NOT belong here, although their path exists:
  //   HTTPSessionTimeoutMinutes    → Access.HTTP.SessionTimeout        (ISO-8601 duration)
  //   IdleConnectionTimeOutSeconds → Access.Network.IdleConnectionTimeOut (ditto)
  //   ServerCAMURI                 → Access.CAM.ServerURIs             (field, schema says text)
  //   MTQ                          → Performance.MTQ.{UseAllThreads|NumberOfThreadsToUse}
  // This table only maps names. The four additionally need a
  // VALUE conversion — and MTQ even writes TWO leaves from one field. That is why this
  // lives in `configAlias.ts` and runs in `save()` before this table.
};

/**
 * Resolve the dotted PATCH path for an edit key against the snapshot's leaf paths
 * (preferred — they include unset params), then staticKeys, then hardcoded overrides.
 *
 * Returns undefined when the server's config tree knows no such leaf: writing the name to
 * the root would earn a `400 code 278` and tell the user nothing, so the caller reports it
 * as a validation error instead. An empty path set means "server told us nothing" — then
 * the legacy flat attempt is still the best available guess.
 */
export function resolveWritePath(name: string, paths: Set<string>): string | undefined {
  if (name.includes('.')) { return paths.has(name) ? name : undefined; }
  // Exact root-level hit wins: live 11.8 accepts PATCH {"ServerName": …} at the root
  // even though Administration.ServerName exists as well.
  if (paths.has(name)) { return name; }
  const matches = [...paths].filter(p => p.endsWith('.' + name));
  // Shortest path = the least nested namesake; deterministic if TM1 ever repeats a leaf.
  if (matches.length > 0) { return matches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0]; }
  const override = STATIC_PATCH_PATH_OVERRIDES[name];
  return override && paths.has(override) ? override : undefined;
}

/**
 * Reverse of the rewrite table: the tm1s.cfg name for a REST leaf.
 *
 * Without it the row loses its description. The flat row is suppressed
 * because it describes the same target (`PortNumber` ->
 * `Access.CAPI.Port`) — what remains is the nested one, and under its
 * last segment (`Port`) `lookupSchema` finds nothing. Measured on 2026-08-31:
 * all twenty parameters resolved via the table showed up in
 * the form as "Nested config-leaf: …" without the text the schema
 * carries for them.
 */
const _flatByPath = new Map(
  Object.entries(STATIC_PATCH_PATH_OVERRIDES).map(([flat, leafPath]) => [leafPath, flat]),
);
export function flatNameForPath(leafPath: string): string | undefined {
  return _flatByPath.get(leafPath);
}

/**
 * The schema entry for a name, whether flat (`SecurityPackageName`) or
 * nested (`Access.Authentication.IntegratedSecurityMode`).
 *
 * The form keeps its rows under the NESTED name; the schema is keyed
 * flat. That is why until 2026-09-18 `save()` failed for every
 * nested row — `lookupSchema` returned `undefined`, `coerceType`
 * passed the raw value from the form through unchanged, and TM1 got every number
 * and every enum value as a string. It became visible with
 * `IntegratedSecurityMode`: `400 code 278 Invalid enum value encountered in
 * payload.`, while the same number bare gives a `200`.
 */
export function schemaFor(name: string): ParamDef | undefined {
  const direct = lookupSchema(name);
  if (direct || !name.includes('.')) { return direct; }
  const renamedFrom = flatNameForPath(name);
  return lookupSchema(name.split('.').pop()!) ?? (renamedFrom ? lookupSchema(renamedFrom) : undefined);
}

function resolvePatchPath(name: string, hint: SaveHint): string | undefined {
  if (hint.paths?.size) { return resolveWritePath(name, hint.paths); }
  if (name.includes('.')) { return name; }
  if (hint.staticKeys?.has(name)) { return name; }
  if (hint.staticKeys) {
    for (const k of hint.staticKeys) {
      if (k.endsWith('.' + name)) { return k; }
    }
  }
  return STATIC_PATCH_PATH_OVERRIDES[name] ?? name;
}

// TM1 11.x rejects PATCH on /ActiveConfiguration ("HTTP 400 code 278: PATCH not allowed
// on this resource"). Only /StaticConfiguration accepts PATCH (matches tm1py's
// ConfigurationService.update_static — no update_active counterpart). The server re-reads
// tm1.cfg on success; runtime-effective params take effect immediately, the rest need a
// restart (schema's requiresRestart flag, or unknown nested keys conservatively).
export async function save(cfg: Tm1Config, edits: Map<string, unknown>, hint: SaveHint = {}): Promise<SaveResult> {
  const entries: Array<[string, unknown]> = [];
  const restartNeeded: string[] = [];
  const errors: SaveError[] = [];

  for (const [name, raw] of edits) {
    const cls = classify(name);
    if (cls.readonly) {
      errors.push({ target: 'validation', param: name, message: vscode.l10n.t('Parameter "{0}" is read-only and cannot be changed.', name) });
      continue;
    }
    const def = schemaFor(name);

    // Names whose leaf is named differently AND carries a different value go
    // through `configAlias`: it delivers finished path/value pairs, possibly
    // several from one field (MTQ). Before `coerceType`, because the conversion there
    // replaces the schema's type check.
    const aliased = resolveWriteAlias(name, raw);
    if (aliased) {
      if (aliased.kind === 'invalid') {
        errors.push({ target: 'validation', param: name, message: aliased.expected === 'mtq'
          ? vscode.l10n.t('"{0}" takes ALL, a whole number of threads, or a negative number meaning all cores minus that many.', name)
          : vscode.l10n.t('"{0}" takes a number that is zero or greater.', name) });
        continue;
      }
      entries.push(...aliased.entries);
      if (!def || def.requiresRestart || cls.requiresRestart) { restartNeeded.push(name); }
      continue;
    }

    let val: unknown;
    try {
      val = coerceType(raw, def);
    } catch (e) {
      errors.push({ target: 'validation', param: name, message: errMsg(e) });
      continue;
    }

    const patchPath = resolvePatchPath(name, hint);
    if (patchPath === undefined) {
      errors.push({ target: 'validation', param: name, message: vscode.l10n.t('Parameter "{0}" does not exist in this server\'s StaticConfiguration and cannot be written via REST.', name) });
      continue;
    }

    // The form shows time spans in seconds, TM1 wants them back as an ISO-8601
    // duration. This is recognized by the leaf's most recently READ value, not by
    // a name list — so no new time field falls by the wayside.
    if (isIsoDuration(hint.values?.get(patchPath))) {
      const secs = Number(typeof val === 'string' ? val.trim() : val);
      if (!Number.isFinite(secs) || secs < 0) {
        errors.push({ target: 'validation', param: name, message: vscode.l10n.t('"{0}" takes a number of seconds that is zero or greater.', name) });
        continue;
      }
      val = secondsToIsoDuration(secs);
    }

    entries.push([patchPath, val]);
    if (!def || def.requiresRestart || cls.requiresRestart) { restartNeeded.push(name); }
  }

  if (entries.length > 0) {
    const body = unflatten(entries);
    const res = await apiRequest('PATCH', 'StaticConfiguration', JSON.stringify(body), undefined, cfg);
    if (res.statusCode === 400 && /Invalid\s+\w+\s+property/i.test(res.body)) {
      // Path-shape mismatch — TM1 didn't recognize the nested path. Some dynamic
      // params live only in /Configuration (legacy flat) but TM1py + observations
      // show flat-key PATCH against /StaticConfiguration can succeed for those.
      // Retry with flat keys before giving up.
      const flatBody: Record<string, unknown> = {};
      for (const [path, val] of entries) {
        const leaf = path.includes('.') ? path.split('.').pop()! : path;
        flatBody[leaf] = val;
      }
      const retry = await apiRequest('PATCH', 'StaticConfiguration', JSON.stringify(flatBody), undefined, cfg);
      if (!isOk(retry)) {
        errors.push({ target: 'static', statusCode: retry.statusCode, message: `Nested PATCH 400, flat retry HTTP ${retry.statusCode}: ${retry.body}` });
      }
    } else if (!isOk(res)) {
      errors.push({ target: 'static', statusCode: res.statusCode, message: res.body });
    }
  }

  return { errors, restartNeeded };
}
