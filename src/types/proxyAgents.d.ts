// Ambient module shims for https-proxy-agent / http-proxy-agent (v9).
//
// These packages ship ESM-only type definitions behind an `exports` map, which
// the project's classic `moduleResolution` (module: commonjs) cannot resolve —
// `tsc -p ./` errors TS2307 even though esbuild bundles the real implementation
// fine at build time. Rather than switch moduleResolution project-wide (100+
// files), declare the minimal surface the transport factory uses. The runtime
// classes come from the real bundled packages; only the types are shimmed.

declare module 'https-proxy-agent' {
  import * as http from 'http';
  export class HttpsProxyAgent<Uri = string> extends http.Agent {
    constructor(proxy: Uri | URL, opts?: http.AgentOptions & { rejectUnauthorized?: boolean; [k: string]: unknown });
    readonly connectOpts: http.AgentOptions & { rejectUnauthorized?: boolean };
  }
}

declare module 'http-proxy-agent' {
  import * as http from 'http';
  export class HttpProxyAgent<Uri = string> extends http.Agent {
    constructor(proxy: Uri | URL, opts?: http.AgentOptions & { [k: string]: unknown });
  }
}
