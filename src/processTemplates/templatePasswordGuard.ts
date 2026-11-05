import { redactPassword } from '../utils/dataSourceWire';
import type { ProcessTemplate } from './processTemplateTypes';

/**
 * Drop the ODBC password from a process template.
 *
 * A template is persisted twice over — into `globalState` and, on export, into
 * a `tm1-process-templates.json` bundle meant to be handed around. TM1's
 * encrypted password is not a server-bound secret (see
 * `utils/dataSourceWire#redactPassword`), so either copy would be a working
 * database credential for whoever holds the file.
 *
 * Applied on both ends of the store — save AND read — so that templates
 * captured before this guard existed stop leaking as well, without a
 * migration.
 */
export function redactTemplatePassword(tpl: ProcessTemplate): ProcessTemplate {
  if (!tpl?.source?.DataSource) { return tpl; }
  return { ...tpl, source: { ...tpl.source, DataSource: redactPassword(tpl.source.DataSource) } };
}
