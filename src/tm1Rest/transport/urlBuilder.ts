// src/tm1Rest/transport/urlBuilder.ts
// Pure REST URL assembly. v11 keeps the flat /api/v1 prefix; v12 roots every
// data call under /{instance}/api/v1/Databases('{db}'). No runtime deps.
import type { Tm1Config } from './types';
import { encodeODataKey } from '../../utils/odataKey';

function root(cfg: Tm1Config): string {
  return cfg.serverUrl.replace(/\/$/, '');
}

/** Base URL for data-plane REST calls (everything callers append a path to). */
export function buildBaseUrl(cfg: Tm1Config): string {
  if (cfg.version === 'v12' && cfg.v12?.authMode === 'saas') {
    // PA as a Service: tenant + database in the path, then the flat v11-style
    // API (measured 2026-10-14, 12.6.4). The database NAME works here.
    const tenant = encodeURIComponent(cfg.v12.instance);
    return `${root(cfg)}/api/${tenant}/v0/tm1/${encodeURIComponent(cfg.v12.database)}/api/v1`;
  }
  if (cfg.version === 'v12' && cfg.v12) {
    const inst = encodeURIComponent(cfg.v12.instance);
    return `${root(cfg)}/${inst}/api/v1/Databases('${encodeODataKey(cfg.v12.database)}')`;
  }
  return `${root(cfg)}/api/v1`;
}

/** v12 session-mint endpoint: POST here with Basic/Bearer to get a TM1SessionId cookie. */
export function buildV12SessionUrl(cfg: Tm1Config): string {
  const inst = encodeURIComponent(cfg.v12?.instance ?? 'tm1');
  return `${root(cfg)}/${inst}/auth/v1/session`;
}
