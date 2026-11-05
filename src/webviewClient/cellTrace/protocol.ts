// src/webviewClient/cellTrace/protocol.ts
export type CalcTypeDTO = 'Simple' | 'Consolidation' | 'Rule';
export type StatusDTO = 'Null' | 'Data' | 'Error';

export interface CalcNodeDTO {
  type: CalcTypeDTO;
  status: StatusDTO;
  value: number | string | null;
  statements: string[];
  tuple: string[];
  /** Cube of this cell — differs from the parent's for a `DB()` operand. */
  cube?: string;
  components: CalcNodeDTO[];
  /** `false` until the children of this node have been traced. */
  childrenLoaded: boolean;
}
export interface FedCellDTO { tuple: string[]; fed: boolean; value: number | string | null }
export interface FeederDTO { statements: string[]; fedCells: FedCellDTO[] }

/** The three things this panel can show for one cell. */
export type TraceKind = 'rule' | 'feeders' | 'check';

export type TracePanelIn =
  /** `kind` lets the panel switch its active tab before the result arrives. */
  | { type: 'loading'; kind?: TraceKind }
  | { type: 'error'; message: string }
  | { type: 'ruleResult'; cube: string; coords: string; root: CalcNodeDTO; rules?: string; dims: string[] }
  /** Answer to `expand`: the node traced one level deep, plus its cube's dimensions. */
  | { type: 'children'; id: number; node: CalcNodeDTO; dims: string[] }
  | { type: 'childrenError'; id: number; message: string }
  | { type: 'feedersResult'; cube: string; coords: string; feeders: FeederDTO; rules?: string }
  | { type: 'checkResult'; cube: string; coords: string; unfed: FedCellDTO[] };

// ── Webview → Host ──────────────────────────────────────────────
export type TracePanelOut =
  | { type: 'openRule'; cube: string; line: number }
  /** Re-run the SAME cell in another mode — the panel is keyed per cell, so the
   *  host still holds cube/dims/coords and only swaps the trace call. */
  | { type: 'switchMode'; kind: TraceKind }
  /** Trace one more level below a node — the tree is loaded one level per call. */
  | { type: 'expand'; id: number; cube: string; coords: string[] };
