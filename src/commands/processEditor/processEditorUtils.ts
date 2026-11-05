/**
 * Pure utility functions for the Process Editor.
 * No network or vscode dependencies — fully testable in isolation.
 *
 * For types-only imports: processEditorTypes.ts
 * For linting (uses apiRequest + server lint): processEditorLint.ts
 */

import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import type { ProcessData } from './processEditorTypes';
import { mergeVariableColumns } from '../../utils/processVariablesUi';

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function parseAsciiLine(line: string, delimiter: string, quoteChar: string): string[] {
  if (!delimiter) { return [line]; }
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === quoteChar) {
        if (line[i + 1] === quoteChar) { current += ch; i++; }
        else { inQuote = false; }
      } else {
        current += ch;
      }
    } else if (ch === quoteChar) {
      inQuote = true;
    } else if (delimiter.length === 1 ? ch === delimiter : line.startsWith(delimiter, i)) {
      result.push(current);
      current = '';
      if (delimiter.length > 1) { i += delimiter.length - 1; }
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function getV12DeprecatedNames(): string[] {
  return [...KNOWN_SIGNATURES.values()]
    .filter(s => s.deprecatedInV12)
    .map(s => s.name);
}

// ─── Data transforms ──────────────────────────────────────────────────────────

export function extractProcessData(processName: string, json: any): ProcessData {
  return {
    processName,
    parameters: json.Parameters ?? [],
    dataSource: json.DataSource ?? { Type: 'None' },
    // Columns with Contents="Ignore" exist only in VariablesUIData; merging both
    // lists is the only way the editor sees the datasource's full column list.
    variables: mergeVariableColumns(json.Variables, json.VariablesUIData),
    prolog: json.PrologProcedure ?? '',
    metadata: json.MetadataProcedure ?? '',
    data: json.DataProcedure ?? '',
    epilog: json.EpilogProcedure ?? '',
    hasSecurity: json.HasSecurityAccess ?? false,
  };
}

export function getPanelTitle(processName: string, dirty: boolean, serverLabel?: string): string {
  const base = serverLabel ? `${serverLabel} : ${processName}` : processName;
  return dirty ? `● ${base}` : base;
}
