import { KNOWN_SIGNATURES } from './tiSignatures';

/**
 * Single source of truth for TI system variables — pseudo-vars that may appear
 * as LHS or RHS without a prior assignment. Consumed by the in-editor linter
 * (tiLinter.ts) and the pre-deploy linter (processEditorUtils.ts).
 *
 * Auto-derived `datasource*` entries come from KNOWN_SIGNATURES; the rest are
 * explicit because TM1 exposes them as session-state, not as builtin functions.
 */
export const TI_SYSTEM_VARIABLES: ReadonlySet<string> = new Set<string>([
  // Auto-derived: every Datasource* builtin is also a pseudo-var
  ...[...KNOWN_SIGNATURES.keys()].filter(k => k.startsWith('datasource')),
  // VIEW/SUBSET/Hierarchy datasource state (read-only context, not in signatures)
  'datasourceview',
  'datasourcesubset',
  'datasourcedimension',
  'datasourcecurrentrecordindex',
  'datasourcehierarchyname',
  'datasourceodbcusername',
  'datasourceodbcpassword',
  'datasourceodbcdsn',
  // Cell value context (Data tab)
  'nvalue',
  'svalue',
  'value_is_string',
  'numericglobalcontext',
  'stringglobalcontext',
  // Minor-error control (assignable LHS + readable)
  'minorerrorlogmax',
  'onminorerrordoitemskip',
]);
