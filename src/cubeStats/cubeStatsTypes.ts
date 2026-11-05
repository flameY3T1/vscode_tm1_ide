export type StatFormat = 'bytes' | 'int' | 'num' | 'pct';

export interface StatMeasure {
  /** Stable JS-Key (used in Record values + sort). */
  key: string;
  /** Column header in webview. */
  label: string;
  /** Element name in TM1 measures dim. */
  tm1: string;
  format: StatFormat;
}

/**
 * Order = column order in the dashboard.
 * `tm1` = element name in the Measures dim of `}StatsByCube`.
 */
export const STATS_MEASURES: readonly StatMeasure[] = [
  { key: 'totalMemoryBytes',   label: 'RAM Total',      tm1: 'Total Memory Used',                  format: 'bytes' },
  { key: 'memoryInputBytes',   label: 'RAM Input',      tm1: 'Memory Used for Input Data',         format: 'bytes' },
  { key: 'memoryViewsBytes',   label: 'RAM Views',      tm1: 'Memory Used for Views',              format: 'bytes' },
  { key: 'memoryFeedersBytes', label: 'RAM Feeders',    tm1: 'Memory Used for Feeders',            format: 'bytes' },
  { key: 'memoryCalcBytes',    label: 'RAM Calc',       tm1: 'Memory Used for Calculations',       format: 'bytes' },
  { key: 'numericCells',       label: 'Num Cells',      tm1: 'Number of Populated Numeric Cells',  format: 'int' },
  { key: 'stringCells',        label: 'Str Cells',      tm1: 'Number of Populated String Cells',   format: 'int' },
  { key: 'fedCells',           label: 'Fed Cells',      tm1: 'Number of Fed Cells',                format: 'int' },
  { key: 'calcCells',          label: 'Calc Cells',     tm1: 'Number of Stored Calculated Cells',  format: 'int' },
  { key: 'storedViews',        label: 'Stored Views',   tm1: 'Number of Stored Views',             format: 'int' },
  { key: 'cacheMissRate',      label: 'Cache Miss %',   tm1: 'Rule calculation cache miss rate',   format: 'pct' },
  { key: 'avgCalcSteps',       label: 'Avg Calc Steps', tm1: 'Steps of Average Calculation',       format: 'num' },
] as const;

export interface CubeStat {
  name: string;
  isSystem: boolean;
  /** key (from STATS_MEASURES) → numeric value. Missing measures = 0. */
  values: Record<string, number>;
}
