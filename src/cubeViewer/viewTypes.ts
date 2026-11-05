import type { DimElementSelection } from '../webviewClient/dimensionBrowser/protocol';

/**
 * What the viewer puts on one axis. On top of the dimension browser's element
 * selections this carries two REFERENCE forms taken from a saved view's own
 * axes (`_fetchViewAxisSubsets`): a registered subset and an MDX subset
 * expression. Both reproduce an axis of ANY size without listing its members —
 * expanding them to names truncates large views.
 *
 * Lives apart from `view.ts` so `axisMdxPure.ts` can speak this vocabulary
 * without importing the module that consumes it (dependency cycle).
 */
export type ViewDimSelection =
  | DimElementSelection
  | { kind: 'namedSubset'; name: string; isPrivate?: boolean }
  | { kind: 'expression'; expression: string };
