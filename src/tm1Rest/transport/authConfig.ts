// src/tm1Rest/transport/authConfig.ts
// Construction boundary for `Tm1Config`. Form/profile state carries the auth
// fields loosely (authType + optional camNamespace/version/v12); this mapper
// validates the per-mode requirements and returns a valid `Tm1Auth` shape,
// throwing with a clear message on invalid combos (CAM without namespace,
// v12 without a v12 config). Pure — no vscode.
import type { AuthType, Tm1Config, Tm1ConfigBase, V12Config } from './types';
import { pawTarget } from '../../utils/pawTarget';

/** Loosely-typed auth fields as they arrive from a form or persisted profile. */
export interface AuthFields {
  authType:      AuthType;
  camNamespace?: string;
  version?:      'v11' | 'v12';
  v12?:          V12Config;
  /** Integrated only: Kerberos service name when reverse DNS does not give it. */
  spn?:          string;
}

/**
 * Folds loose base + auth fields into a valid `Tm1Config`. Throws on the
 * previously-representable invalid states so a misconfiguration surfaces as a
 * clear error at construction instead of an opaque 401 (CAM) or a mint failure
 * (v12) deep in the transport.
 */
export function buildTm1Config(base: Tm1ConfigBase, auth: AuthFields): Tm1Config {
  switch (auth.authType) {
    case 'CAM': {
      if (!auth.camNamespace) {
        throw new Error('CAM authentication requires a namespace (camNamespace).');
      }
      return { ...base, authType: 'CAM', camNamespace: auth.camNamespace };
    }
    case 'integrated': {
      // v11 only — v12 mints its session via the auth endpoint, without
      // SPNEGO. A v12 setting here is a configuration error and should be
      // loud instead of fading away into a 401.
      if (auth.version === 'v12' || auth.v12) {
        throw new Error('Integrated (Windows) authentication is v11 only — v12 uses its own session endpoint.');
      }
      const spn = auth.spn?.trim();
      return { ...base, authType: 'integrated', ...(spn ? { spn } : {}) };
    }
    case 'v12-basic': {
      if (auth.version !== 'v12' || !auth.v12) {
        throw new Error('v12-basic authentication requires version "v12" and a v12 config.');
      }
      return { ...base, authType: 'v12-basic', version: 'v12', v12: auth.v12 };
    }
    case 'browser': {
      // Two shapes, both measured 2026-10-25: PA SaaS (v12, authMode saas,
      // tenant + database in the path) or a PAW gateway URL (v11). Anything
      // else would open a browser on a page whose cookies carry nothing.
      if (auth.version === 'v12' || auth.v12) {
        const v12 = auth.v12;
        if (auth.version !== 'v12' || !v12 || v12.authMode !== 'saas' || !v12.instance || !v12.database) {
          throw new Error('Browser login on v12 requires PA SaaS: authMode "saas", tenant and database.');
        }
        return { ...base, authType: 'browser', version: 'v12', v12: { ...v12, authMode: 'saas' } };
      }
      if (!pawTarget(base.serverUrl)) {
        throw new Error('Browser login on v11 requires a PAW URL of the form <paw>/api/v1/tm1/<instance>.');
      }
      return { ...base, authType: 'browser' };
    }
    case 'Basic':
    default:
      return { ...base, authType: 'Basic' };
  }
}
