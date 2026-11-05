// src/webviewClient/feederAudit/protocol.ts
// Messages between the overfeeding window and the host (webviews/feederAuditWebview.ts).
// The result types live here so the bundle and the host share one definition;
// the host re-exports them.

/** A feeder statement that this cell can have produced. */
export interface AuditFeeder {
  /** 0-based line in the rule text — jump target in the rule editor. */
  zeile: number;
  text: string;
  /** `false` = cannot be decided (expression in the area, unknown element). */
  sicher: boolean;
  grund?: string;
}

/** A hit row. */
export interface AuditHit {
  cube: string;
  koordinaten: string[];
  /** Missing as long as nobody has expanded the row. */
  feeder?: AuditFeeder[];
  /** The assignment for exactly this cell has failed. */
  feederFehler?: string;
}

/** Result of a run, sent to the window. */
export interface AuditResult {
  cube: string;
  dimensionen: string[];
  treffer: AuditHit[];
  /** Rows that could not be read as a coordinate (comma in the element name). */
  verworfen: number;
  /** The area was full — it continues behind the last cell shown. */
  gekappt: boolean;
  /** First requested cell, 1-based. */
  von: number;
  /** Last requested cell, inclusive. */
  bis: number;
  /** Was the cube cache cleared before this run? */
  cacheLeeren: boolean;
  /** Error text instead of a result. */
  fehler?: string;
}

export type WebviewToHost =
  | { type: 'matchCell'; index: number }
  | { type: 'openRule'; zeile: number }
  | { type: 'rerun'; von: number; bis: number; cacheLeeren: boolean };

export type HostToWebview =
  | { type: 'result'; ergebnis: AuditResult }
  | { type: 'running' }
  | { type: 'cellFeeder'; index: number; feeder: AuditFeeder[]; fehler?: string };
