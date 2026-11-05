import type { Tm1Config } from '../tm1Rest/transport/types';
import { apiRequest } from '../tm1Rest/client';
import { parseBodySafe } from '../tm1Rest/parseRest';
import { updateProcess } from '../tm1Rest/processApi';
import { updateCubeRules } from '../tm1Rest/cubeApi';
import { invalidateReferenceIndex } from '../references/referenceIndexService';
import type { ObjectCorpusEntry, ObjectEdit, UnitKey } from './model';
import type { ApplyReport } from './protocol';

interface ODataEnvelope<T> { value?: T[]; }

const PROC_SECTIONS: Array<[UnitKey, string]> = [
  ['prolog', 'PrologProcedure'], ['metadata', 'MetadataProcedure'],
  ['data', 'DataProcedure'], ['epilog', 'EpilogProcedure'],
];
const SECTION_FIELD: Record<'prolog' | 'metadata' | 'data' | 'epilog', string> = {
  prolog: 'PrologProcedure', metadata: 'MetadataProcedure',
  data: 'DataProcedure', epilog: 'EpilogProcedure',
};

export function mapProcessRows(rows: Array<Record<string, unknown>>): ObjectCorpusEntry[] {
  return rows.map(r => {
    const units = PROC_SECTIONS
      .map(([key, field]) => ({ key, text: String(r[field] ?? '') }))
      .filter(u => u.text !== '');
    return { objectKind: 'process' as const, objectName: String(r.Name ?? ''), units };
  }).filter(e => e.objectName !== '' && e.units.length > 0);
}

export function mapRuleRows(rows: Array<Record<string, unknown>>): ObjectCorpusEntry[] {
  return rows.map(r => ({
    objectKind: 'rule' as const,
    objectName: String(r.Name ?? ''),
    units: [{ key: 'rule' as UnitKey, text: String(r.Rules ?? '') }],
  })).filter(e => e.objectName !== '' && e.units[0].text !== '');
}

export async function fetchCorpus(cfg: Tm1Config): Promise<{ corpus: ObjectCorpusEntry[]; unreadable: string[] }> {
  const unreadable: string[] = [];
  const [procRes, ruleRes] = await Promise.all([
    apiRequest('GET',
      'Processes?$select=Name,PrologProcedure,MetadataProcedure,DataProcedure,EpilogProcedure',
      undefined, 60_000, cfg).catch(() => { unreadable.push('Processes'); return null; }),
    apiRequest('GET', 'Cubes?$select=Name,Rules', undefined, 60_000, cfg)
      .catch(() => { unreadable.push('Cubes'); return null; }),
  ]);
  // Parse with a `null` fallback (not `{}`) so a corrupt 200-body — HTML error
  // page, truncated JSON — is distinguishable from a valid empty collection. A
  // parse failure is surfaced as `unreadable` (same UI path as a failed request)
  // instead of silently collapsing to "0 matches". `procRes === null` means the
  // request itself already failed and pushed to `unreadable` above.
  // `apiRequest` resolves on non-2xx too — a 403/500 error body is valid JSON
  // and would otherwise read as an empty collection.
  const procParsed = procRes && procRes.statusCode === 200
    ? parseBodySafe<ODataEnvelope<Record<string, unknown>> | null>(procRes, null) : null;
  if (procRes && procParsed === null) { unreadable.push('Processes'); }
  const procRows = procParsed?.value ?? [];
  const ruleParsed = ruleRes && ruleRes.statusCode === 200
    ? parseBodySafe<ODataEnvelope<Record<string, unknown>> | null>(ruleRes, null) : null;
  if (ruleRes && ruleParsed === null) { unreadable.push('Cubes'); }
  const ruleRows = ruleParsed?.value ?? [];
  return { corpus: [...mapProcessRows(procRows), ...mapRuleRows(ruleRows)], unreadable };
}

// Lives in the protocol module (vscode-free) because the webview reads it.
export type { ApplyReport } from './protocol';

export async function applyEdits(cfg: Tm1Config, edits: ObjectEdit[]): Promise<ApplyReport> {
  const applied: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    try {
      if (e.objectKind === 'rule') {
        await updateCubeRules(cfg, e.objectName, e.newRules ?? '');
      } else {
        const body: Record<string, string> = {};
        for (const [key, text] of Object.entries(e.changedSections)) {
          body[SECTION_FIELD[key as keyof typeof SECTION_FIELD]] = text as string;
        }
        await updateProcess(cfg, e.objectName, body); // no Name field
      }
      applied.push(e.objectName);
    } catch (err) {
      invalidateReferenceIndex(cfg);
      return {
        applied,
        failed: { object: e.objectName, error: (err as Error).message },
        notAttempted: edits.slice(i + 1).map(x => x.objectName),
      };
    }
  }
  invalidateReferenceIndex(cfg);
  return { applied, notAttempted: [] };
}
