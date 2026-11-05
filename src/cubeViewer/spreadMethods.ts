export type SpreadMethod = 'proportional' | 'percentage' | 'repeat' | 'clear';

export interface SpreadMethodMeta {
  needsValue: boolean;
  codePrefix: string;
}

/**
 * No `label` here: the labels of the distribution methods live as
 * translation keys in `commands/cubeViewer/cubeViewerL10n.ts`
 * (`spreadProportional` etc.) and reach the webview via `L`. Until
 * 2026-08-30 a second, German set stood next to it in this module, which
 * nothing read — only `needsValue` and `codePrefix` are needed.
 */
export const SPREAD_METHODS: Record<SpreadMethod, SpreadMethodMeta> = {
  proportional: { needsValue: true,  codePrefix: 'P' },
  percentage:   { needsValue: true,  codePrefix: 'R%' },
  // `LR` = value into every leaf. Plain `R` on a single consolidated cell spreads
  // proportionally like `P` (measured 2026-11-05, 11.8).
  repeat:       { needsValue: true,  codePrefix: 'LR' },
  clear:        { needsValue: false, codePrefix: 'R0' },
};
